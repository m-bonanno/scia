import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AUDIO_CONTAINERS, type AudioContainer, PageFailure, titleOfVideo } from '@scia/core';
import { mediaSchema } from '@scia/contracts';
import { z } from 'zod';
import { PageError, type PageFormat } from './media-choice.ts';
import type { PageMedia, PageReader } from './page-reader.ts';

// What yt-dlp is always told (docs/adr/0009). It reads one page and prints what it found; it
// downloads nothing — the engine does. It never guesses a site it has no reader of its own for
// (the generic one is left out), never works around a geographic restriction, never reads a
// cookie — from a file or from a browser's store — and never reads a configuration or writes a
// cache of its own on this computer (CLAUDE.md, "Respect the hosts").
const ALWAYS = [
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

// A read prints the page's whole description, as one JSON object.
const READ = ['--dump-single-json'] as const;
// A ready row's title (#285) is printed alone: as JSON — every character past ASCII escaped, so
// that no code page of the system changes it — on a line of its own, one for each video of a list.
// The videos of a list are not read one by one for it: a page that turns out to be a list stays
// one request.
const TITLE = ['--print', '%(title)j', '--flat-playlist'] as const;

// A page's description can be long — a format per quality and per host — but not this long.
const MOST_OUTPUT_BYTES = 32 * 1024 * 1024;
// A title is a line: what runs on past this is no title.
const MOST_TITLE_BYTES = 64 * 1024;
// A title is wanted while the person looks at the row, not after a whole read's wait.
const TITLE_LIMIT_MS = 30_000;
// What is kept of the error stream: its end, where yt-dlp says why it stopped.
const MOST_ERROR_BYTES = 64 * 1024;

// What a site says of a format is checked where it enters, against what the contract takes: a
// height that is no count of lines is no height, and a container that is no short word is no
// format Scia names a file after.
const height = z
  .unknown()
  .transform((value) => mediaSchema.shape.height.safeParse(value).data ?? null);
const bitrate = z
  .unknown()
  .transform((value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null,
  );
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
  // Of a sound offered apart (docs/adr/0021): its bitrate in kbit/s, and how much the site
  // prefers its language.
  abr: bitrate.optional(),
  tbr: bitrate.optional(),
  language_preference: z
    .unknown()
    .transform((value) => (Number.isSafeInteger(value) ? (value as number) : null))
    .optional(),
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

// A container of sound, for a format that is sound alone: the sound of a picture offered apart.
function soundContainerOf(format: Format): AudioContainer | undefined {
  const ext = format.ext ?? '';
  return isSoundAlone(format) && SOUND_CONTAINERS.has(ext) ? (ext as AudioContainer) : undefined;
}

function toFormat(format: Format): PageFormat | undefined {
  const ext = mediaSchema.shape.ext.safeParse(format.ext ?? 'mp4').data ?? soundContainerOf(format);
  // Not a container of a video, nor of a sound alone — a document, a program — or none at all.
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
    bitrate: format.abr ?? format.tbr ?? null,
    languagePreference: format.language_preference ?? null,
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
  // The program to run: yt-dlp itself, or whatever stands in for it. Asked at each read: the build
  // in use changes when a newer one is taken (docs/adr/0011), and a read under way keeps its own.
  readonly command: string | (() => string);
  // Arguments that come before Scia's own: a script, when `command` is an interpreter.
  readonly prefix?: readonly string[];
  // A page that has said nothing by then is given up.
  readonly timeoutMs: number;
  // A title that has not come by then is given up: TITLE_LIMIT_MS unless told.
  readonly titleTimeoutMs?: number;
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

// What one run asks of yt-dlp, and how long and how much it may answer.
interface Ask {
  readonly told: readonly string[];
  readonly timeoutMs: number;
  readonly mostOutputBytes: number;
}

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

// yt-dlp's builds unpack themselves and read the page in a second process, which inherits the
// output: ending the first alone leaves the second reading, and the output open (#170). So the
// whole tree is ended — on Windows by taskkill, elsewhere as the process group it leads.
const APART = process.platform !== 'win32';

function endTree(child: ChildProcess): void {
  const { pid } = child;
  if (pid === undefined) return;
  if (APART) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }
  const systemRoot = process.env.SystemRoot;
  const taskkill =
    systemRoot === undefined ? 'taskkill.exe' : join(systemRoot, 'System32', 'taskkill.exe');
  // Built from nothing, as yt-dlp's own: the engine's environment holds the API's token. A
  // taskkill that cannot start, or ends nothing, leaves the first process to end alone.
  spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
    env: systemRoot === undefined ? {} : { SystemRoot: systemRoot },
    stdio: 'ignore',
    windowsHide: true,
  })
    .on('error', () => child.kill())
    .on('exit', (code) => {
      if (code !== 0) child.kill();
    });
}

// Once Scia has ended the reader, what still holds its output — a process no tree reaches, its
// parent gone — is not waited for.
const OUTPUT_GRACE_MS = 1000;

// The adapter of PageReader over yt-dlp, run once per page (docs/adr/0009).
export class YtDlp implements PageReader {
  readonly #options: YtDlpOptions;

  constructor(options: YtDlpOptions) {
    this.#options = options;
  }

  async read(url: string, signal: AbortSignal): Promise<PageMedia | undefined> {
    const run = await this.#inFolderOfItsOwn(url, signal, {
      told: READ,
      timeoutMs: this.#options.timeoutMs,
      mostOutputBytes: this.#options.mostOutputBytes ?? MOST_OUTPUT_BYTES,
    });
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

  // The same request as a read, under the same rules, for one line: the title, made one line of
  // text a row can show (#285).
  async readTitle(url: string, signal: AbortSignal): Promise<string | undefined> {
    const run = await this.#inFolderOfItsOwn(url, signal, {
      told: TITLE,
      timeoutMs: this.#options.titleTimeoutMs ?? TITLE_LIMIT_MS,
      mostOutputBytes: MOST_TITLE_BYTES,
    });
    if (run.code !== 0) {
      const refusal = refusalOf(run.stderr);
      if (refusal === undefined) return undefined;
      throw refusal;
    }
    const lines = run.stdout.split(/\r?\n/).filter((line) => line !== '');
    const [line] = lines;
    if (line === undefined) return undefined;
    // A line for each video: the page is a list, and its title no one video's.
    if (lines.length > 1) throw new PageError(PageFailure.Playlist, 'The page is not one video.');
    let title: unknown;
    try {
      title = JSON.parse(line);
    } catch (error) {
      throw new PageError(PageFailure.Unreadable, 'The reader printed no title.', {
        cause: error,
      });
    }
    if (typeof title !== 'string') {
      throw new PageError(PageFailure.Unreadable, 'The reader printed no title.');
    }
    return titleOfVideo(title);
  }

  async #inFolderOfItsOwn(url: string, signal: AbortSignal, ask: Ask): Promise<Run> {
    signal.throwIfAborted();
    await mkdir(this.#options.tempDir, { recursive: true });
    const temp = await mkdtemp(join(this.#options.tempDir, 'scia-yt-dlp-'));
    try {
      return await this.#run(url, temp, signal, ask);
    } finally {
      // After the process has closed, whatever ended it: Windows may hold its files a moment.
      await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }

  #run(url: string, temp: string, signal: AbortSignal, ask: Ask): Promise<Run> {
    return new Promise((resolve, reject) => {
      // Stopped while its folder was being made: an abort that has happened is never heard again.
      if (signal.aborted) {
        reject(signal.reason as Error);
        return;
      }
      const { prefix = [] } = this.#options;
      const { told, timeoutMs, mostOutputBytes } = ask;
      const command =
        typeof this.#options.command === 'string' ? this.#options.command : this.#options.command();
      const child = spawn(command, [...prefix, ...told, ...ALWAYS, '--', url], {
        env: environmentOf(temp),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: APART,
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let release: NodeJS.Timeout | undefined;
      const letOutputGo = () => {
        release ??= setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
        }, OUTPUT_GRACE_MS);
      };
      child.on('close', () => {
        clearTimeout(release);
      });
      // Settled only once the process has closed: its folder is removed after, not under it.
      let outcome: (() => void) | undefined;
      const end = (settle: () => void) => {
        if (outcome !== undefined) return;
        outcome = settle;
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        if (child.exitCode === null && child.signalCode === null) endTree(child);
        else letOutputGo();
      };
      child.on('exit', () => {
        if (outcome !== undefined) letOutputGo();
      });
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
