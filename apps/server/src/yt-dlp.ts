import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AUDIO_CONTAINERS, PageFailure } from '@scia/core';
import { mediaSchema } from '@scia/contracts';
import { z } from 'zod';
import { PageError, type PageFormat } from './media-choice.ts';
import type { PageMedia, PageReader } from './page-reader.ts';

// What yt-dlp is always told (docs/adr/0009). It reads one page and prints what it found, as one
// JSON object; it downloads nothing — the engine does. It never guesses a site it has no reader
// of its own for (the generic one is left out), never works around a geographic restriction,
// never reads a cookie — from a file or from a browser's store — and never reads a configuration
// or writes a cache of its own on this computer (CLAUDE.md, "Respect the hosts").
const ALWAYS = [
  '--dump-single-json',
  '--no-playlist',
  '--ignore-config',
  '--no-cache-dir',
  '--no-cookies',
  '--no-cookies-from-browser',
  '--xff',
  'never',
  '--use-extractors',
  'default,-generic',
  '--socket-timeout',
  '30',
  // No plugin from beside the program or from the person's folders: nothing but yt-dlp itself.
  '--no-plugin-dirs',
] as const;

// A page's description can be long — a format per quality and per host — but not this long.
const MOST_OUTPUT_BYTES = 32 * 1024 * 1024;
// What is kept of the error stream: its end, where yt-dlp says why it stopped.
const MOST_ERROR_BYTES = 64 * 1024;

// What a site says of a format is checked where it enters, against what the contract takes: a
// height that is no count of lines is no height, and a container that is no short word is no
// format Scia names a file after.
const height = z
  .unknown()
  .transform((value) => mediaSchema.shape.height.safeParse(value).data ?? null);
const formatSchema = z.object({
  url: z.string(),
  protocol: z.string().optional(),
  // However the site spells it: `MP4` is an mp4.
  ext: z.string().toLowerCase().optional(),
  vcodec: z.string().nullable().optional(),
  acodec: z.string().nullable().optional(),
  height: height.optional(),
  has_drm: z.unknown().optional(),
  http_headers: z.record(z.string(), z.string()).optional(),
});
const infoSchema = formatSchema.partial({ url: true }).extend({
  _type: z.string().optional(),
  title: z.string().optional(),
  formats: z.array(formatSchema).optional(),
});
type Format = z.infer<typeof formatSchema>;

// What a client chooses for itself, or what concerns the connection and not the site: never
// taken from what a site asks for. A site's `Range` would turn the answer of a download without
// ranges into a part of it, and its `Accept-Encoding` into compressed bytes; and Scia sends no
// cookie a person has not handed over.
const NOT_THE_SITES = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authorization',
  'range',
  'te',
  'transfer-encoding',
  'upgrade',
]);

function headersOf(given: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(given ?? {}).filter(([name]) => !NOT_THE_SITES.has(name.toLowerCase())),
  );
}

const SOUND_CONTAINERS: ReadonlySet<string> = new Set(AUDIO_CONTAINERS);

// No picture: the site says so (`vcodec: none`), or names no codec of picture for a container
// of sound — yt-dlp gives archive.org's audio items as one mp3 with no codec named.
function isSoundAlone(format: Format): boolean {
  if (format.vcodec === 'none') return true;
  return (format.vcodec ?? undefined) === undefined && SOUND_CONTAINERS.has(format.ext ?? '');
}

function toFormat(format: Format): PageFormat | undefined {
  const ext = mediaSchema.shape.ext.safeParse(format.ext ?? 'mp4').data;
  // Not a container of a video — an audio file, a document, a program — or none at all.
  if (ext === undefined) return undefined;
  return {
    url: format.url,
    protocol: format.protocol ?? 'https',
    ext,
    vcodec: format.vcodec ?? undefined,
    acodec: format.acodec ?? undefined,
    height: format.height ?? null,
    // yt-dlp says `true`, or "maybe" when it cannot tell: either is not taken.
    hasDrm: format.has_drm !== undefined && format.has_drm !== false && format.has_drm !== null,
    headers: headersOf(format.http_headers),
  };
}

// What yt-dlp says it failed with, read for the cause it names: its `ERROR:` lines only — its
// warnings name formats it passed over, not why it stopped. Its words are an extractor's, not a
// contract.
const NOT_A_KNOWN_SITE = /No suitable extractor found|Unsupported URL/i;
// Before the rest: "HTTP Error 503: Service Unavailable" is a site in maintenance, not a video
// that cannot be played.
const BUSY = /HTTP Error (5\d\d|429)|timed out|temporarily unavailable|try again later/i;
// A page of a site it knows that plays no video — a book, an image, a collection — said in
// yt-dlp's own words, seen from its 2026.10.26 build: archive.org's reader, and its own when a
// site gives no format. Such a page is fetched as it stands, as before yt-dlp read pages (#89).
const NO_VIDEO = /opening play-av tag not found|No video formats found/i;
const PROTECTED = /\bDRM\b/i;
const UNAVAILABLE =
  /unavailable|not available|private video|has been removed|sign in|log ?in|login required|members only|geo.?restrict|in your country/i;

function refusalOf(stderr: string): PageError | undefined {
  const errors = stderr
    .split(/\r?\n/)
    .filter((line) => line.startsWith('ERROR:'))
    .join('\n');
  if (NOT_A_KNOWN_SITE.test(errors) || NO_VIDEO.test(errors)) return undefined;
  if (BUSY.test(errors)) return new PageError(PageFailure.SiteBusy, 'The site did not answer.');
  if (PROTECTED.test(errors)) return new PageError(PageFailure.Drm, 'The video is protected.');
  if (UNAVAILABLE.test(errors)) {
    return new PageError(PageFailure.VideoUnavailable, 'The site says the video cannot be played.');
  }
  // An error no rule knows, or not one line of yt-dlp's own: never taken for a page with no
  // video, which would save a site's HTML where its video was asked for.
  return new PageError(PageFailure.Unreadable, 'The page could not be read.');
}

export interface YtDlpOptions {
  // The program to run: yt-dlp itself, or whatever stands in for it.
  readonly command: string;
  // Arguments that come before Scia's own: a script, when `command` is an interpreter.
  readonly prefix?: readonly string[];
  // A page that has said nothing by then is given up.
  readonly timeoutMs: number;
  // Where each run gets a folder of its own for its temporary files, removed when it ends: the
  // builds of yt-dlp unpack themselves there — 30 MB — and leave it behind when they are stopped.
  readonly tempDir: string;
  readonly mostOutputBytes?: number;
}

// yt-dlp's whole environment, built from nothing: the engine's own holds the API's token, which
// is no business of a program that reads pages. SystemRoot is what Windows' network needs.
function environmentOf(temp: string): Record<string, string> {
  const systemRoot = process.env.SystemRoot;
  return {
    ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }),
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
  };
}

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

// The adapter of PageReader over yt-dlp, run once per page (docs/adr/0009).
export class YtDlp implements PageReader {
  readonly #options: YtDlpOptions;

  constructor(options: YtDlpOptions) {
    this.#options = options;
  }

  async read(url: string, signal: AbortSignal): Promise<PageMedia | undefined> {
    const run = await this.#inFolderOfItsOwn(url, signal);
    if (run.code !== 0) {
      const refusal = refusalOf(run.stderr);
      if (refusal === undefined) return undefined;
      throw refusal;
    }
    let info: z.infer<typeof infoSchema>;
    try {
      info = infoSchema.parse(JSON.parse(run.stdout));
    } catch (error) {
      throw new PageError(
        PageFailure.Unreadable,
        'The reader said something Scia does not understand.',
        { cause: error },
      );
    }
    if (info._type !== undefined && info._type !== 'video') {
      throw new PageError(
        info._type === 'playlist' ? PageFailure.Playlist : PageFailure.Unreadable,
        'The page is not one video.',
      );
    }
    const given = info.formats ?? (info.url === undefined ? [] : [{ ...info, url: info.url }]);
    if (given.length === 0) {
      throw new PageError(PageFailure.Unreadable, 'The reader found the page and no format.');
    }
    // Sound alone in every format — an album, an audio book: a page that plays no video, fetched
    // as it stands. Read from what yt-dlp gave, before the containers Scia lists are kept: a video
    // in a container it does not list is not a page with no video.
    if (given.every(isSoundAlone)) return undefined;
    const formats = given.map(toFormat).filter((format) => format !== undefined);
    if (formats.length === 0) {
      throw new PageError(PageFailure.FormatUnsupported, 'No format is in a container Scia knows.');
    }
    return { title: info.title, formats };
  }

  async #inFolderOfItsOwn(url: string, signal: AbortSignal): Promise<Run> {
    signal.throwIfAborted();
    await mkdir(this.#options.tempDir, { recursive: true });
    const temp = await mkdtemp(join(this.#options.tempDir, 'scia-yt-dlp-'));
    try {
      return await this.#run(url, temp, signal);
    } finally {
      // After the process has closed, whatever ended it: Windows may hold its files a moment.
      await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }

  #run(url: string, temp: string, signal: AbortSignal): Promise<Run> {
    return new Promise((resolve, reject) => {
      // Stopped while its folder was being made: an abort that has happened is never heard again.
      if (signal.aborted) {
        reject(signal.reason as Error);
        return;
      }
      const { command, prefix = [], timeoutMs } = this.#options;
      const mostOutputBytes = this.#options.mostOutputBytes ?? MOST_OUTPUT_BYTES;
      const child = spawn(command, [...prefix, ...ALWAYS, '--', url], {
        env: environmentOf(temp),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      // Settled only once the process has closed: its folder is removed after, not under it.
      let outcome: (() => void) | undefined;
      const end = (settle: () => void) => {
        if (outcome !== undefined) return;
        outcome = settle;
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        if (child.exitCode === null && child.signalCode === null) child.kill();
      };
      const timer = setTimeout(() => {
        end(() => {
          reject(new PageError(PageFailure.SiteBusy, 'The page said nothing in time.'));
        });
      }, timeoutMs);
      const stop = () => {
        end(() => {
          reject(signal.reason as Error);
        });
      };
      signal.addEventListener('abort', stop, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        outBytes += chunk.byteLength;
        if (outBytes > mostOutputBytes) {
          end(() => {
            reject(new PageError(PageFailure.Unreadable, 'The page said far too much.'));
          });
          return;
        }
        out.push(chunk);
      });
      let errBytes = 0;
      child.stderr.on('data', (chunk: Buffer) => {
        err.push(chunk);
        errBytes += chunk.byteLength;
        while (errBytes > MOST_ERROR_BYTES && err.length > 1)
          errBytes -= err.shift()?.byteLength ?? 0;
      });
      child.on('error', (error) => {
        end(() => {
          reject(
            new PageError(PageFailure.Unreadable, 'The reader of pages could not be started.', {
              cause: error,
            }),
          );
        });
        // A program that never started never closes.
        outcome?.();
      });
      child.on('close', (code) => {
        end(() => {
          resolve({
            code,
            stdout: Buffer.concat(out).toString('utf8'),
            stderr: Buffer.concat(err).toString('utf8'),
          });
        });
        outcome?.();
      });
    });
  }
}
