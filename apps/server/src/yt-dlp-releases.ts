import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';

// Where yt-dlp's project publishes its releases (docs/adr/0011). The latest one is read from where
// github.com's `/releases/latest` redirects, and its files from `/releases/download/<tag>/`: pages
// and files of a public repository, not GitHub's API, whose limit of requests they do not meet.
export const YT_DLP_RELEASES = 'https://github.com/yt-dlp/yt-dlp';

// A release of yt-dlp is named after the day it was made, and a number when it is not the first
// of that day. A nightly build, or any other word, is not one.
const RELEASE = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d{1,6}))?$/;

export function isRelease(tag: string): boolean {
  return RELEASE.test(tag);
}

function partsOf(tag: string): number[] {
  const match = RELEASE.exec(tag);
  if (match === null) throw new Error(`Not a release of yt-dlp: ${tag}`);
  // A release with no number after its date is the first of that day.
  return match.slice(1).map((part: string | undefined) => Number(part ?? 0));
}

export function isNewer(tag: string, than: string): boolean {
  const a = partsOf(tag);
  const b = partsOf(than);
  for (const [index, part] of a.entries()) {
    const other = b[index] ?? 0;
    if (part !== other) return part > other;
  }
  return false;
}

// The day a release says it was made, at its first second in UTC.
export function dayOf(tag: string): Date {
  const [year = 0, month = 1, day = 1] = partsOf(tag);
  return new Date(Date.UTC(year, month - 1, day));
}

// The checksum SHA2-256SUMS gives a build: the one line that names it, `<sha256>  <name>` as
// sha256sum writes it (or `<sha256> *<name>`, in binary mode). None when no line or two lines do.
export function checksumIn(sums: string, name: string): string | undefined {
  const found = sums
    .split('\n')
    .map((line) => /^([0-9a-f]{64}) [ *](.+?)\r?$/.exec(line))
    .filter((match) => match?.[2] === name)
    .map((match) => match?.[1]);
  return found.length === 1 ? found[0] : undefined;
}

// A release that could not be read, or a file of it that could not be fetched: tried again later,
// never a build used.
export class ReleaseError extends Error {
  override readonly name = 'ReleaseError';
}

export interface ReleasesOptions {
  // `https://github.com/yt-dlp/yt-dlp`, or a host on this computer that answers as it does.
  readonly address: string;
  readonly userAgent: string;
  // A host that has said nothing for this long is given up.
  readonly silenceMs?: number;
}

const SILENCE_MS = 30_000;

// Ends a request whose host is silent for `ms`, or when `stop` is aborted.
class Silence {
  readonly controller = new AbortController();
  readonly #ms: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #stop: AbortSignal;
  readonly #stopped = () => {
    this.controller.abort(this.#stop.reason);
  };

  constructor(ms: number, stop: AbortSignal) {
    this.#ms = ms;
    this.#stop = stop;
    stop.addEventListener('abort', this.#stopped, { once: true });
    if (stop.aborted) this.#stopped();
    this.heard();
  }

  heard(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.controller.abort(new ReleaseError('The host of the releases said nothing in time.'));
    }, this.#ms);
  }

  end(): void {
    clearTimeout(this.#timer);
    this.#stop.removeEventListener('abort', this.#stopped);
  }
}

export class YtDlpReleases {
  readonly #options: ReleasesOptions;

  constructor(options: ReleasesOptions) {
    this.#options = options;
  }

  async #ask(path: string, silence: Silence, redirect: 'manual' | 'follow'): Promise<Response> {
    try {
      return await fetch(`${this.#options.address}${path}`, {
        redirect,
        headers: { 'user-agent': this.#options.userAgent, 'accept-encoding': 'identity' },
        signal: silence.controller.signal,
      });
    } catch (error) {
      throw this.#failure(error, silence);
    }
  }

  // What stopped a request: the person's engine stopping, said as it was, or the host.
  #failure(error: unknown, silence: Silence): Error {
    const reason: unknown = silence.controller.signal.reason;
    if (reason instanceof Error) return reason;
    return new ReleaseError('The host of the releases could not be reached.', { cause: error });
  }

  #silence(signal: AbortSignal): Silence {
    return new Silence(this.#options.silenceMs ?? SILENCE_MS, signal);
  }

  // The name of the latest release, read from where github.com sends `/releases/latest`.
  async latest(signal: AbortSignal): Promise<string> {
    const silence = this.#silence(signal);
    try {
      const response = await this.#ask('/releases/latest', silence, 'manual');
      await response.body?.cancel();
      // No redirect is no location, and no tag in it.
      const location = response.headers.get('location') ?? '';
      const tag = /\/releases\/tag\/([^/?#]+)$/.exec(
        new URL(location, response.url || this.#options.address).pathname,
      )?.[1];
      if (tag === undefined || !isRelease(tag)) {
        throw new ReleaseError(
          `The latest release answered ${String(response.status)}, not a release of yt-dlp.`,
        );
      }
      return tag;
    } finally {
      silence.end();
    }
  }

  async #download(
    tag: string,
    name: string,
    mostBytes: number,
    signal: AbortSignal,
    take: (chunk: Uint8Array) => Promise<void>,
  ): Promise<void> {
    const silence = this.#silence(signal);
    try {
      const response = await this.#ask(`/releases/download/${tag}/${name}`, silence, 'follow');
      if (!response.ok || response.body === null) {
        await response.body?.cancel();
        throw new ReleaseError(`${name} of ${tag} answered ${String(response.status)}.`);
      }
      let bytes = 0;
      try {
        for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
          silence.heard();
          bytes += chunk.byteLength;
          if (bytes > mostBytes)
            throw new ReleaseError(`${name} of ${tag} is larger than it may be.`);
          await take(chunk);
        }
      } catch (error) {
        if (error instanceof ReleaseError) throw error;
        throw this.#failure(error, silence);
      }
    } finally {
      silence.end();
    }
  }

  // A small file of a release, whole, in memory: its sums and their signature.
  async file(tag: string, name: string, mostBytes: number, signal: AbortSignal): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    await this.#download(tag, name, mostBytes, signal, (chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    return Buffer.concat(chunks);
  }

  // A build, written to `path` as it arrives; answers the sha256 of what was written. What was
  // written is removed when it does not arrive whole.
  async save(
    tag: string,
    name: string,
    path: string,
    mostBytes: number,
    signal: AbortSignal,
  ): Promise<string> {
    const hash = createHash('sha256');
    const file = await open(path, 'w');
    try {
      await this.#download(tag, name, mostBytes, signal, async (chunk) => {
        hash.update(chunk);
        await file.write(chunk);
      });
      await file.sync();
    } catch (error) {
      await file.close();
      await rm(path, { force: true });
      throw error;
    }
    await file.close();
    return hash.digest('hex');
  }
}
