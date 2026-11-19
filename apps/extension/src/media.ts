import {
  capturableMediaKind,
  fileNameFromContentDisposition,
  fileNameFromUrl,
  type MediaKind,
} from '@scia/core';

// A video or audio file a page loaded, as the popup offers it.
export interface MediaItem {
  readonly url: string;
  readonly kind: MediaKind;
  readonly fileName: string;
  readonly size: number | null;
}

export interface ResponseHeader {
  readonly name: string;
  readonly value?: string | undefined;
}

// What the browser tells of a response it received (chrome.webRequest.onHeadersReceived).
export interface ObservedRequest {
  readonly url: string;
  readonly method: string;
  readonly statusCode: number;
  readonly responseHeaders?: readonly ResponseHeader[] | undefined;
}

// A page that plays a long video asks for it piece by piece; the list keeps the latest files.
export const MEDIA_PER_TAB = 30;

function byteCount(value: string | undefined): number | null {
  const count = Number(value);
  return value !== undefined && value !== '' && Number.isSafeInteger(count) && count >= 0
    ? count
    : null;
}

export function mediaOf(request: ObservedRequest): MediaItem | undefined {
  if (request.method !== 'GET') return undefined;
  if (request.statusCode !== 200 && request.statusCode !== 206) return undefined;
  const header = (name: string) =>
    request.responseHeaders?.find((candidate) => candidate.name.toLowerCase() === name)?.value;
  // A player asks for a range: the size of the file is after the slash, not in the length.
  const size =
    request.statusCode === 206
      ? byteCount(/\/(\d+)$/.exec(header('content-range') ?? '')?.[1])
      : byteCount(header('content-length'));
  const kind = capturableMediaKind({
    url: request.url,
    contentType: header('content-type') ?? null,
    contentLength: size,
  });
  if (kind === undefined) return undefined;
  const disposition = header('content-disposition');
  const named = disposition === undefined ? undefined : fileNameFromContentDisposition(disposition);
  return { url: request.url, kind, fileName: named ?? fileNameFromUrl(request.url), size };
}

// The same file asked twice is one entry; the oldest leave when the list is full.
export function withMedia(list: readonly MediaItem[], item: MediaItem): MediaItem[] {
  return [...list.filter((known) => known.url !== item.url), item].slice(-MEDIA_PER_TAB);
}
