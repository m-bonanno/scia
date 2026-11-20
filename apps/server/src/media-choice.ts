import { type MediaInfo, PageFailure } from '@scia/core';
import type { RequestHeaders } from './remote-source.ts';

// One way a site offers the video of a page, as its reader describes it.
export interface PageFormat {
  readonly url: string;
  // How it is fetched: `http`/`https` is one file; `m3u8`, `m3u8_native`, `http_dash_segments`
  // and the rest are streams.
  readonly protocol: string;
  readonly ext: string;
  // `none` when the format has no picture, or no sound; undefined when the site does not say.
  readonly vcodec: string | undefined;
  readonly acodec: string | undefined;
  readonly height: number | null;
  readonly hasDrm: boolean;
  // What the site asks a client to send with the request: kept with the format.
  readonly headers: RequestHeaders;
}

// The format a download fetches, and what the row says of it.
export interface ChosenMedia {
  readonly url: string;
  readonly headers: RequestHeaders;
  readonly info: MediaInfo;
}

export class PageError extends Error {
  override readonly name = 'PageError';
  readonly failure: PageFailure;

  constructor(failure: PageFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.failure = failure;
  }
}

const ONE_FILE = new Set(['http', 'https']);

function isOneFileWithSound(format: PageFormat): boolean {
  return (
    ONE_FILE.has(format.protocol) &&
    !format.hasDrm &&
    format.vcodec !== 'none' &&
    format.acodec !== 'none'
  );
}

// Higher is better: an mp4 — every player opens one, and it is what the owner asked for (#89) —
// then the lines of picture.
function rank(format: PageFormat): [number, number] {
  return [format.ext === 'mp4' ? 1 : 0, format.height ?? -1];
}

function isAtLeast(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);
}

// The best the site offers that Scia can fetch as it stands: one file, with picture and sound,
// not protected. Between equals the later one the site lists, which its reader orders from worst
// to best. Throws a PageError that says why there is none.
export function chooseMedia(formats: readonly PageFormat[]): ChosenMedia {
  let best: PageFormat | undefined;
  for (const format of formats) {
    if (!isOneFileWithSound(format)) continue;
    if (best === undefined || isAtLeast(rank(format), rank(best))) best = format;
  }
  if (best !== undefined) {
    return { url: best.url, headers: best.headers, info: { ext: best.ext, height: best.height } };
  }
  if (formats.length === 0) {
    throw new PageError(PageFailure.Unreadable, 'The page offers no format of the video.');
  }
  if (formats.every((format) => format.hasDrm)) {
    throw new PageError(PageFailure.Drm, 'The video is protected.');
  }
  throw new PageError(
    PageFailure.FormatUnsupported,
    'The video is offered only as a stream, or as picture and sound apart.',
  );
}
