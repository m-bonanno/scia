import { setTimeout as sleep } from 'node:timers/promises';
import { AlbumFailure, DownloadFailure, PageFailure } from '@scia/core';
import {
  BUNKR_DOMAINS,
  bunkrLinkOf,
  isBunkrHost,
  linkOfAnswer,
  readAlbumPage,
  readFilePage,
} from './bunkr-pages.ts';
import { RemoteError, type RequestHeaders } from './remote-source.ts';

// Bunkr's API, which gives a file's link (docs/adr/0024).
const API = 'https://apidl.bunkr.ru/api/_001_v2';
// The page of Bunkr's that offers a file's download: what its API and its file servers are told
// a file is asked from.
const DOWNLOAD_PAGE = 'https://get.bunkrr.su';
// The longest Scia waits for a page or an answer, and the most it reads of one.
const READ_LIMIT_MS = 30_000;
const ALBUM_PAGE_BYTES = 16 * 1024 * 1024;
const FILE_PAGE_BYTES = 2 * 1024 * 1024;
const ANSWER_BYTES = 64 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// What can heal — a busy site, a dropped connection, no answer in time — is asked again, three
// times at most, after a wait that grows; a site's `Retry-After` is waited for when it asks
// longer, and a site that asks for more than a minute is not asked again.
const ATTEMPTS = 4;
const RETRY_AFTER_LIMIT_MS = 60_000;

function defaultRetryDelayMs(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** (attempt - 1));
}

export interface BunkrOptions {
  // Scia's own, as its downloads send it: never a browser's.
  readonly userAgent: string;
  // A host that answers as Bunkr does, on this computer (`SCIA_BUNKR`, a spec's): Bunkr's links
  // are those of its name, and its API is at the same path as Bunkr's. Bunkr's own otherwise.
  readonly site?: string;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: (attempt: number) => number;
}

export interface Album {
  // What its folder is named after: its title, or its id when it has none.
  readonly name: string;
  // In the album's order: each file's page, and the name the album gives it — a name from a
  // host, as hostile as any.
  readonly files: readonly { readonly url: string; readonly name: string | undefined }[];
}

export interface BunkrFile {
  // The file's link, as Bunkr's API gave it: fetched as any file, and kept nowhere.
  readonly url: string;
  readonly headers: RequestHeaders;
  // The name its page gives it, a name from a host; nothing when it gives none.
  readonly name: string | undefined;
}

function failure(code: DownloadFailure, message: string, status?: number): RemoteError {
  return new RemoteError(code, false, message, status === undefined ? {} : { status });
}

// What a refusal of Bunkr's says, as the row will: not there, refused, or itself. Final: a busy
// site's answers are asked again before any of this (`#fetch`).
function refusalOf(status: number): RemoteError {
  if (status === 404 || status === 410) return failure(AlbumFailure.Gone, 'Not on the site.');
  if (status === 401 || status === 403)
    return failure(AlbumFailure.Refused, 'Refused by the site.');
  return failure(DownloadFailure.HttpStatus, `The site answered ${String(status)}.`, status);
}

// A 429 or a 5xx: the site busy, which a wait can mend.
class Busy extends RemoteError {
  // How long the site asked Scia to wait, when it said.
  readonly retryAfterMs: number | undefined;

  constructor(status: number, retryAfterMs: number | undefined) {
    super(PageFailure.SiteBusy, true, `The site answered ${String(status)}.`, { status });
    this.retryAfterMs = retryAfterMs;
  }
}

// `Retry-After` as seconds, or as a date: a date is the system's clock by what it is, read once.
function retryAfterOf(value: string | null): number | undefined {
  const text = value?.trim() ?? '';
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

const unreadable = (message: string) => failure(AlbumFailure.Unrecognised, message);

// The body, read up to `limit` bytes: one past it is a page Scia does not read.
async function textOf(response: Response, limit: number): Promise<string> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw unreadable('The page is larger than any Scia reads.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Bunkr's album and file pages, read as gallery-dl's reader reads them (docs/adr/0024): which
// files an album lists, and the link of each. Nothing is fetched of a file here: its link is
// fetched as any download, under the speed limit.
export class Bunkr {
  readonly #userAgent: string;
  readonly #domains: readonly string[];
  readonly #api: string;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: (attempt: number) => number;

  constructor(options: BunkrOptions) {
    this.#userAgent = options.userAgent;
    const site = options.site === undefined ? undefined : new URL(options.site);
    this.#domains = site === undefined ? BUNKR_DOMAINS : [site.hostname];
    this.#api = site === undefined ? API : new URL(new URL(API).pathname, site).href;
    this.#timeoutMs = options.timeoutMs ?? READ_LIMIT_MS;
    this.#retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  }

  isAlbum(url: string): boolean {
    return bunkrLinkOf(url, this.#domains)?.kind === 'album';
  }

  isFile(url: string): boolean {
    return bunkrLinkOf(url, this.#domains)?.kind === 'file';
  }

  // Its files, each by its page on the host the album was read at. Rejects with a RemoteError
  // that says why not, or with the reason of `signal`.
  async readAlbum(url: string, signal: AbortSignal): Promise<Album> {
    const link = bunkrLinkOf(url, this.#domains);
    if (link?.kind !== 'album') throw unreadable('Not an album of Bunkr.');
    // `advanced=1`: the page that lists every file, as gallery-dl asks it.
    const { text, at } = await this.#page(
      `${link.origin}/a/${link.id}?advanced=1`,
      ALBUM_PAGE_BYTES,
      signal,
    );
    const album = readAlbumPage(text);
    if (album === undefined)
      throw unreadable('The album lists its files in a way Scia cannot read.');
    if (album.files.length === 0) throw failure(AlbumFailure.Empty, 'The album has no file.');
    const origin = new URL(at).origin;
    let id = link.id;
    try {
      id = decodeURIComponent(link.id);
    } catch {
      // Written as it stands in the address.
    }
    const files = album.files.map((file) => ({
      url: `${origin}/f/${encodeURIComponent(file.slug)}`,
      name: file.name,
    }));
    // A slug the address parser makes into another path (`/f/..` is `/`) would leave Bunkr's road:
    // its row would be asked of a service, and a page saved as the file.
    if (files.some(({ url }) => bunkrLinkOf(url, this.#domains)?.kind !== 'file')) {
      throw unreadable('The album names a file Scia cannot address.');
    }
    return { name: album.title ?? id, files };
  }

  // The link of a file's page, read again at every run: its page for its id, then the API.
  async locateFile(url: string, signal: AbortSignal): Promise<BunkrFile> {
    const link = bunkrLinkOf(url, this.#domains);
    if (link?.kind !== 'file') throw unreadable('Not a file of Bunkr.');
    const { text } = await this.#page(`${link.origin}${link.path}`, FILE_PAGE_BYTES, signal);
    const page = readFilePage(text);
    if (page === undefined) throw unreadable('The page of the file names no file.');
    const referer = `${DOWNLOAD_PAGE}/file/${page.id}`;
    const response = await this.#fetch(
      this.#api,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          referer,
          origin: DOWNLOAD_PAGE,
        },
        body: JSON.stringify({ id: page.id }),
      },
      signal,
      async (answer) => {
        if (REDIRECTS.has(answer.status)) throw unreadable('The API sent Scia elsewhere.');
        // A file the API does not know: what gallery-dl reads as an album deleted.
        if (answer.status === 400) throw failure(AlbumFailure.Gone, 'Not on the site.');
        if (answer.status !== 200) throw refusalOf(answer.status);
        return textOf(answer, ANSWER_BYTES);
      },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(response);
    } catch {
      throw unreadable('The API answered something that is not JSON.');
    }
    const address = linkOfAnswer(parsed);
    if (address === undefined) throw unreadable('The API gave no link Scia can read.');
    return { url: address, headers: { referer }, name: page.name };
  }

  // A page of Bunkr's, following its redirects to a host of the list, five at most. `at`: where
  // it was read in the end.
  async #page(
    url: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<{ text: string; at: string }> {
    let at = url;
    for (let redirects = 0; ; redirects += 1) {
      const answer = await this.#fetch(
        at,
        { method: 'GET', headers: { accept: 'text/html' } },
        signal,
        async (response) => {
          const location = response.headers.get('location');
          if (REDIRECTS.has(response.status) && location !== null) return { location };
          if (response.status !== 200) throw refusalOf(response.status);
          return { text: await textOf(response, limit) };
        },
      );
      if ('text' in answer) return { text: answer.text, at };
      const next = URL.parse(answer.location, at);
      if (
        next === null ||
        (next.protocol !== 'http:' && next.protocol !== 'https:') ||
        !isBunkrHost(next.hostname, this.#domains) ||
        redirects >= MAX_REDIRECTS
      ) {
        throw unreadable('The site sent Scia off its pages.');
      }
      at = next.href;
    }
  }

  // One request, asked again while what went wrong can heal (`ATTEMPTS`), and given up at a stop.
  async #fetch<T>(
    url: string,
    init: { readonly method: string; readonly headers: RequestHeaders; readonly body?: string },
    signal: AbortSignal,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#once(url, init, signal, read);
      } catch (error) {
        const waitMs =
          error instanceof RemoteError && error.retryable && attempt < ATTEMPTS && !signal.aborted
            ? this.#waitBefore(attempt, error)
            : undefined;
        if (waitMs === undefined) throw error;
        await sleep(waitMs, undefined, { signal });
      }
    }
  }

  // Scia's own wait, or the site's when it asks longer; none when it asks for more than Scia
  // waits.
  #waitBefore(attempt: number, error: RemoteError): number | undefined {
    const asked = error instanceof Busy ? error.retryAfterMs : undefined;
    if (asked !== undefined && asked > RETRY_AFTER_LIMIT_MS) return undefined;
    return Math.max(this.#retryDelayMs(attempt), asked ?? 0);
  }

  // One request, read by `read` within the time Scia gives the site. A site that is busy or took
  // too long, and one that could not be reached, can heal; what `read` refuses cannot.
  async #once<T>(
    url: string,
    init: { readonly method: string; readonly headers: RequestHeaders; readonly body?: string },
    signal: AbortSignal,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...init.headers, 'user-agent': this.#userAgent },
        redirect: 'manual',
        signal: AbortSignal.any([signal, timeout]),
      });
      try {
        if (response.status === 429 || response.status >= 500) {
          throw new Busy(response.status, retryAfterOf(response.headers.get('retry-after')));
        }
        return await read(response);
      } finally {
        // An answer not read to its end keeps its connection.
        await response.body?.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      if (timeout.aborted) {
        throw new RemoteError(PageFailure.SiteBusy, true, 'The site said nothing in time.');
      }
      throw new RemoteError(DownloadFailure.Network, true, 'The site could not be reached.', {
        cause: error,
      });
    }
  }
}
