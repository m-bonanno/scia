import { type MediaInfo, PageFailure, type VideoContainer } from '@scia/core';
import type { RequestHeaders } from './remote-source.ts';

// One way a site offers the video of a page, as its reader describes it.
export interface PageFormat {
  readonly url: string;
  // How it is fetched: `http`/`https` is one file; `m3u8`, `m3u8_native`, `http_dash_segments`
  // and the rest are streams.
  readonly protocol: string;
  readonly ext: VideoContainer;
  // `none` when the format has no picture, or no sound; undefined when the site does not say.
  readonly vcodec: string | undefined;
  readonly acodec: string | undefined;
  readonly height: number | null;
  readonly hasDrm: boolean;
  // What the site asks a client to send with the request: kept with the format.
  readonly headers: RequestHeaders;
}

// The format a download fetches, and what the row says of it.
// How its bytes are fetched: as one file, or as the pieces of an HLS stream made into an mp4.
export type MediaKind = 'file' | 'hls';

export interface ChosenMedia {
  readonly url: string;
  readonly headers: RequestHeaders;
  readonly kind: MediaKind;
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
// The pieces of an HLS stream, which the engine makes into an mp4 (docs/adr/0010). DASH is not one.
const HLS = new Set(['m3u8', 'm3u8_native']);

const kindOf = (format: PageFormat): MediaKind => (HLS.has(format.protocol) ? 'hls' : 'file');
// A stream becomes an mp4 whatever its pieces are.
const containerOf = (format: PageFormat) => (kindOf(format) === 'hls' ? 'mp4' : format.ext);

function isOneVideoWithSound(format: PageFormat): boolean {
  return (
    (ONE_FILE.has(format.protocol) || HLS.has(format.protocol)) &&
    !format.hasDrm &&
    format.vcodec !== 'none' &&
    format.acodec !== 'none'
  );
}

// Higher is better: an mp4 — every player opens one, and it is what the owner asked for (#89) —
// then the lines of picture, then a file over a stream, which is fetched as it stands.
function rank(format: PageFormat): readonly number[] {
  return [
    containerOf(format) === 'mp4' ? 1 : 0,
    format.height ?? -1,
    kindOf(format) === 'file' ? 1 : 0,
  ];
}

function isAtLeast(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

// The best the site offers that Scia can fetch as it stands: one file, with picture and sound,
// not protected. Between equals the later one the site lists, which its reader orders from worst
// to best. Throws a PageError that says why there is none.
// `container`, when given, is the only one taken: a download that already holds bytes of an mp4
// goes on as an mp4, or not at all.
export function chooseMedia(formats: readonly PageFormat[], container?: string): ChosenMedia {
  let best: PageFormat | undefined;
  for (const format of formats) {
    if (!isOneVideoWithSound(format)) continue;
    if (container !== undefined && containerOf(format) !== container) continue;
    if (best === undefined || isAtLeast(rank(format), rank(best))) best = format;
  }
  if (best !== undefined) {
    return {
      url: best.url,
      headers: best.headers,
      kind: kindOf(best),
      info: { ext: containerOf(best), height: best.height },
    };
  }
  if (formats.length === 0) {
    throw new PageError(PageFailure.Unreadable, 'The page offers no format of the video.');
  }
  if (formats.every((format) => format.hasDrm)) {
    throw new PageError(PageFailure.Drm, 'The video is protected.');
  }
  throw new PageError(
    PageFailure.FormatUnsupported,
    'The video is offered only as DASH, or as picture and sound apart.',
  );
}
