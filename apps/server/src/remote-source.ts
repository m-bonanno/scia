import type { DownloadFailure } from '@scia/core';

export type RequestHeaders = Readonly<Record<string, string>>;

// What a host says of a file before a byte of it is fetched.
export interface RemoteFile {
  readonly totalBytes: number | null;
  readonly acceptsRanges: boolean;
  // The name the host gives the file, when it gives one.
  readonly fileName: string | undefined;
  // ETag or Last-Modified: the same file answers the same tomorrow, another file does not.
  readonly validator: string | null;
}

// [start, end), as a Segment.
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

// The port a download reaches its bytes through. HttpSource is the one adapter today; a debrid
// service or an HLS playlist will be others (docs/adr/0001).
export interface RemoteSource {
  probe(url: string, headers: RequestHeaders, signal: AbortSignal): Promise<RemoteFile>;
  // The bytes of `range`, or the whole file from its first byte when null. What is answered is
  // read at once, to its end or until the reader leaves the loop, which closes it: a body that
  // nobody starts to read is watched by nothing, and keeps its connection.
  open(
    url: string,
    headers: RequestHeaders,
    range: ByteRange | null,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>>;
}

export class RemoteError extends Error {
  override readonly name = 'RemoteError';
  readonly failure: DownloadFailure;
  // Worth another attempt: a dropped connection, a busy host. A 404 is not.
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    failure: DownloadFailure,
    retryable: boolean,
    message: string,
    options: ErrorOptions & { readonly status?: number } = {},
  ) {
    super(message, options);
    this.failure = failure;
    this.retryable = retryable;
    this.status = options.status ?? null;
  }
}

export class DiskError extends Error {
  override readonly name = 'DiskError';
}
