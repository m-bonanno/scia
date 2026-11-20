import { spawn } from 'node:child_process';
import { PageFailure } from '@scia/core';
import { z } from 'zod';
import { PageError, type PageFormat } from './media-choice.ts';
import type { PageMedia, PageReader } from './page-reader.ts';

// What yt-dlp is always told (docs/adr/0008). It reads one page and prints what it found, as one
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
] as const;

// A page's description can be long — a format per quality and per host — but not this long.
const MOST_OUTPUT_BYTES = 32 * 1024 * 1024;

const formatSchema = z.object({
  url: z.string(),
  protocol: z.string().optional(),
  ext: z.string().optional(),
  vcodec: z.string().nullable().optional(),
  acodec: z.string().nullable().optional(),
  height: z.number().nullable().optional(),
  has_drm: z.unknown().optional(),
  http_headers: z.record(z.string(), z.string()).optional(),
});
const infoSchema = z.object({
  _type: z.string().optional(),
  title: z.string().optional(),
  formats: z.array(formatSchema).optional(),
  // A video whose site gives one address and no list of formats.
  url: z.string().optional(),
  protocol: z.string().optional(),
  ext: z.string().optional(),
  vcodec: z.string().nullable().optional(),
  acodec: z.string().nullable().optional(),
  height: z.number().nullable().optional(),
  has_drm: z.unknown().optional(),
  http_headers: z.record(z.string(), z.string()).optional(),
});
type Format = z.infer<typeof formatSchema>;

function toFormat(format: Format): PageFormat {
  return {
    url: format.url,
    protocol: format.protocol ?? 'https',
    ext: format.ext ?? 'mp4',
    vcodec: format.vcodec ?? undefined,
    acodec: format.acodec ?? undefined,
    height: format.height ?? null,
    // yt-dlp says `true`, or "maybe" when it cannot tell: either is not taken.
    hasDrm: format.has_drm !== undefined && format.has_drm !== false && format.has_drm !== null,
    headers: format.http_headers ?? {},
  };
}

// What yt-dlp says on its error stream, read for the cause it names. Its words are an
// extractor's, not a contract: what no rule matches is "could not be read".
const NOT_A_KNOWN_SITE = /No suitable extractor found|Unsupported URL/i;
const PROTECTED = /\bDRM\b/i;
const UNAVAILABLE =
  /unavailable|not available|private video|has been removed|sign in|log ?in|login required|members only|geo.?restrict|in your country/i;

function refusalOf(stderr: string): PageError | undefined {
  if (NOT_A_KNOWN_SITE.test(stderr)) return undefined;
  if (PROTECTED.test(stderr)) return new PageError(PageFailure.Drm, 'The video is protected.');
  if (UNAVAILABLE.test(stderr)) {
    return new PageError(PageFailure.VideoUnavailable, 'The site says the video cannot be played.');
  }
  return new PageError(PageFailure.Unreadable, 'The page could not be read.');
}

export interface YtDlpOptions {
  // The program to run: yt-dlp itself, or whatever stands in for it.
  readonly command: string;
  // Arguments that come before Scia's own: a script, when `command` is an interpreter.
  readonly prefix?: readonly string[];
  // A page that has said nothing by then is given up.
  readonly timeoutMs: number;
}

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

// The adapter of PageReader over yt-dlp, run once per page (docs/adr/0008).
export class YtDlp implements PageReader {
  readonly #options: YtDlpOptions;

  constructor(options: YtDlpOptions) {
    this.#options = options;
  }

  async read(url: string, signal: AbortSignal): Promise<PageMedia | undefined> {
    const run = await this.#run(url, signal);
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
        {
          cause: error,
        },
      );
    }
    if (info._type !== undefined && info._type !== 'video') {
      throw new PageError(
        info._type === 'playlist' ? PageFailure.Playlist : PageFailure.Unreadable,
        'The page is not one video.',
      );
    }
    const formats = info.formats ?? (info.url === undefined ? [] : [{ ...info, url: info.url }]);
    return { title: info.title, formats: formats.map(toFormat) };
  }

  #run(url: string, signal: AbortSignal): Promise<Run> {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const { command, prefix = [], timeoutMs } = this.#options;
      const child = spawn(command, [...prefix, ...ALWAYS, '--', url], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let settled = false;
      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        outcome();
      };
      const kill = () => {
        if (child.exitCode === null) child.kill();
      };
      const timer = setTimeout(() => {
        kill();
        finish(() => {
          reject(new PageError(PageFailure.Unreadable, 'The page said nothing in time.'));
        });
      }, timeoutMs);
      const stop = () => {
        kill();
        finish(() => {
          reject(signal.reason as Error);
        });
      };
      signal.addEventListener('abort', stop, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        outBytes += chunk.byteLength;
        if (outBytes > MOST_OUTPUT_BYTES) {
          kill();
          finish(() => {
            reject(new PageError(PageFailure.Unreadable, 'The page said far too much.'));
          });
          return;
        }
        out.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        err.push(chunk);
      });
      child.on('error', (error) => {
        finish(() => {
          reject(
            new PageError(PageFailure.Unreadable, 'The reader of pages could not be started.', {
              cause: error,
            }),
          );
        });
      });
      child.on('close', (code) => {
        finish(() => {
          resolve({
            code,
            stdout: Buffer.concat(out).toString('utf8'),
            stderr: Buffer.concat(err).toString('utf8'),
          });
        });
      });
    });
  }
}
