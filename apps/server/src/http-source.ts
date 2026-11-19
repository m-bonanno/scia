import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import {
  DownloadFailure,
  FALLBACK_FILE_NAME,
  fileNameFromContentDisposition,
  fileNameFromUrl,
} from '@scia/core';
import {
  type ByteRange,
  type RemoteFile,
  RemoteError,
  type RemoteSource,
  type RequestHeaders,
} from './remote-source.ts';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;
// A connection that sends nothing for this long is dead: the segment tries again.
const IDLE_TIMEOUT_MS = 30_000;
const BUSY = new Set([408, 425, 429]);

interface Answer {
  readonly response: IncomingMessage;
  readonly url: string;
  readonly redirected: boolean;
}

function refusal(status: number): RemoteError {
  return new RemoteError(
    DownloadFailure.HttpStatus,
    status >= 500 || BUSY.has(status),
    `The host answered ${String(status)}.`,
    { status },
  );
}

function headerOf(response: IncomingMessage, name: string): string | undefined {
  const value = response.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function byteCount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function totalOfContentRange(value: string | undefined): number | null {
  return byteCount(/^bytes\s+\d+-\d+\/(\d+)$/i.exec(value?.trim() ?? '')?.[1]);
}

// Node reads header bytes as Latin-1; hosts that send a UTF-8 name unencoded arrive garbled.
function headerText(value: string): string {
  const utf8 = Buffer.from(value, 'latin1').toString('utf8');
  return utf8.includes('�') ? value : utf8;
}

function nameOf(answer: Answer): string | undefined {
  const disposition = headerOf(answer.response, 'content-disposition');
  const named =
    disposition === undefined ? undefined : fileNameFromContentDisposition(headerText(disposition));
  if (named !== undefined) return named;
  // «download.php?id=5» that lands on «…/setup.exe»: the second is the file's name.
  const landed = answer.redirected ? fileNameFromUrl(answer.url) : FALLBACK_FILE_NAME;
  return landed === FALLBACK_FILE_NAME ? undefined : landed;
}

export class HttpSource implements RemoteSource {
  readonly #userAgent: string;
  readonly #agents = {
    http: new http.Agent({ keepAlive: true }),
    https: new https.Agent({ keepAlive: true }),
  };

  constructor(userAgent: string) {
    this.#userAgent = userAgent;
  }

  async probe(url: string, headers: RequestHeaders, signal: AbortSignal): Promise<RemoteFile> {
    // HEAD is refused or wrong on many hosts; the first byte of a GET says the same and more.
    let answer = await this.#get(url, { ...headers, range: 'bytes=0-0' }, signal);
    if (answer.response.statusCode === 416) {
      // An empty file has no first byte to give.
      answer.response.destroy();
      answer = await this.#get(url, headers, signal);
    }
    const { response } = answer;
    response.destroy();
    const status = response.statusCode ?? 0;
    if (status !== 200 && status !== 206) throw refusal(status);
    const totalBytes =
      status === 206
        ? totalOfContentRange(headerOf(response, 'content-range'))
        : byteCount(headerOf(response, 'content-length'));
    return {
      totalBytes,
      acceptsRanges: status === 206 && totalBytes !== null,
      fileName: nameOf(answer),
      validator: headerOf(response, 'etag') ?? headerOf(response, 'last-modified') ?? null,
    };
  }

  async open(
    url: string,
    headers: RequestHeaders,
    range: ByteRange | null,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>> {
    const ranged =
      range === null
        ? headers
        : { ...headers, range: `bytes=${String(range.start)}-${String(range.end - 1)}` };
    const { response } = await this.#get(url, ranged, signal);
    const status = response.statusCode ?? 0;
    const expected = range === null ? 200 : 206;
    if (status !== expected) {
      response.destroy();
      // A 200 to a range means the host stopped serving ranges: nothing a retry can mend.
      throw status === 200
        ? new RemoteError(DownloadFailure.HttpStatus, false, 'The host ignored the range.', {
            status,
          })
        : refusal(status);
    }
    return response;
  }

  close(): void {
    this.#agents.http.destroy();
    this.#agents.https.destroy();
  }

  #get(url: string, headers: RequestHeaders, signal: AbortSignal, redirects = 0): Promise<Answer> {
    return new Promise<Answer>((resolve, reject) => {
      const target = new URL(url);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        reject(new RemoteError(DownloadFailure.Network, false, 'Not an HTTP address.'));
        return;
      }
      const secure = target.protocol === 'https:';
      const request = (secure ? https : http).request(
        target,
        {
          method: 'GET',
          agent: secure ? this.#agents.https : this.#agents.http,
          signal,
          headers: {
            'user-agent': this.#userAgent,
            accept: '*/*',
            // A compressed body would not match the ranges asked for.
            'accept-encoding': 'identity',
            ...headers,
          },
        },
        (response) => {
          const location = response.headers.location;
          if (!REDIRECTS.has(response.statusCode ?? 0) || location === undefined) {
            resolve({ response, url: target.href, redirected: redirects > 0 });
            return;
          }
          response.resume();
          if (redirects >= MAX_REDIRECTS) {
            reject(new RemoteError(DownloadFailure.Network, false, 'Too many redirects.'));
            return;
          }
          resolve(this.#get(new URL(location, target).href, headers, signal, redirects + 1));
        },
      );
      request.setTimeout(IDLE_TIMEOUT_MS, () => {
        request.destroy(new Error('The host stopped answering.'));
      });
      request.on('error', (error) => {
        reject(
          signal.aborted
            ? error
            : new RemoteError(DownloadFailure.Network, true, 'The host could not be reached.', {
                cause: error,
              }),
        );
      });
      request.end();
    });
  }
}
