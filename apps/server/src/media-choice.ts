import {
  type AudioContainer,
  type MediaInfo,
  PageFailure,
  VIDEO_CONTAINERS,
  type VideoContainer,
} from '@scia/core';
import type { RequestHeaders } from './remote-source.ts';

// One way a site offers the video of a page, as its reader describes it.
export interface PageFormat {
  readonly url: string;
  // How it is fetched: `http`/`https` is one file; `m3u8`, `m3u8_native`, `http_dash_segments`
  // and the rest are streams.
  readonly protocol: string;
  // A container of sound only for a format with no picture: the sound of a picture offered apart.
  readonly ext: VideoContainer | AudioContainer;
  // `none` when the format has no picture, or no sound; undefined when the site does not say.
  readonly vcodec: string | undefined;
  readonly acodec: string | undefined;
  readonly height: number | null;
  readonly hasDrm: boolean;
  // What the site asks a client to send with the request: kept with the format.
  readonly headers: RequestHeaders;
  // Of a sound: its bitrate, in kbit/s, when the site says.
  readonly bitrate: number | null;
  // How much the site prefers its language: the video's own above a dubbed one; null when it
  // does not say.
  readonly languagePreference: number | null;
}

// The format a download fetches, and what the row says of it.
// How its bytes are fetched: as one file, as the pieces of an HLS stream made into an mp4, or as
// a picture and a sound in two files, joined into one mp4 (docs/adr/0021).
export type MediaKind = 'file' | 'hls' | 'pair';

export interface MediaSource {
  readonly url: string;
  readonly headers: RequestHeaders;
}

// Of a pair, `url` and `headers` are the picture's, and `sound` the sound's.
export interface ChosenMedia extends MediaSource {
  readonly kind: MediaKind;
  readonly info: MediaInfo;
  readonly sound?: MediaSource;
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
const VIDEO: ReadonlySet<string> = new Set(VIDEO_CONTAINERS);

const kindOf = (format: PageFormat): MediaKind => (HLS.has(format.protocol) ? 'hls' : 'file');
// A stream becomes an mp4 whatever its pieces are.
const containerOf = (format: PageFormat) => (kindOf(format) === 'hls' ? 'mp4' : format.ext);

function isOneVideoWithSound(format: PageFormat): boolean {
  return (
    (ONE_FILE.has(format.protocol) || HLS.has(format.protocol)) &&
    VIDEO.has(format.ext) &&
    !format.hasDrm &&
    format.vcodec !== 'none' &&
    format.acodec !== 'none'
  );
}

// The picture codecs Scia joins (the owner, #99): H.264, which every player opens, and AV1, for a
// higher quality. Never HEVC, which Windows plays only with a paid extension, nor VP9, offered in
// a webm.
const H264 = /^(avc1|avc3|h264)\b/i;
const AV1 = /^av01\b/i;
const AAC = /^mp4a\b/i;

const isOneFile = (format: PageFormat) => ONE_FILE.has(format.protocol) && !format.hasDrm;

const isPicture = (format: PageFormat) =>
  isOneFile(format) &&
  format.ext === 'mp4' &&
  format.acodec === 'none' &&
  (H264.test(format.vcodec ?? '') || AV1.test(format.vcodec ?? ''));

const isSound = (format: PageFormat) =>
  isOneFile(format) &&
  (format.ext === 'm4a' || format.ext === 'mp4') &&
  format.vcodec === 'none' &&
  AAC.test(format.acodec ?? '');

// How one file, a pair and a stream stand at as many lines: one file is fetched as it stands, a
// pair is two files to join, a stream pieces to put together.
const WAY = { file: 2, pair: 1, hls: 0 } as const;

// Higher is better: an mp4 — every player opens one, and it is what the owner asked for (#89) —
// then the lines of picture, then the way it is fetched.
function rank(format: PageFormat): readonly number[] {
  return [containerOf(format) === 'mp4' ? 1 : 0, format.height ?? -1, WAY[kindOf(format)]];
}

// Of pictures: the lines, then H.264 over AV1.
const pictureRank = (format: PageFormat): readonly number[] => [
  format.height ?? -1,
  H264.test(format.vcodec ?? '') ? 1 : 0,
];

// Of sounds: the video's own language, then the bitrate.
const soundRank = (format: PageFormat): readonly number[] => [
  format.languagePreference ?? 0,
  format.bitrate ?? 0,
];

function isAtLeast(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

// The best of the formats by `by`; between equals the later one.
function bestOf(
  formats: readonly PageFormat[],
  by: (format: PageFormat) => readonly number[],
): PageFormat | undefined {
  let best: PageFormat | undefined;
  for (const format of formats) {
    if (best === undefined || isAtLeast(by(format), by(best))) best = format;
  }
  return best;
}

// The best the site offers that Scia can fetch, not protected: one file or a stream with picture
// and sound, or a picture and a sound offered apart, which Scia joins into an mp4
// (docs/adr/0021). Between equals the later one the site lists, which its reader orders from
// worst to best. Throws a PageError that says why there is none.
// `container`, when given, is the only one taken: a download that already holds bytes of an mp4
// goes on as an mp4, or not at all. `joins` false takes no pair: a download whose join Scia
// refused chooses among one files and streams only (#241).
export function chooseMedia(
  formats: readonly PageFormat[],
  container?: string,
  { joins = true }: { readonly joins?: boolean } = {},
): ChosenMedia {
  const best = bestOf(
    formats.filter(
      (format) =>
        isOneVideoWithSound(format) &&
        (container === undefined || containerOf(format) === container),
    ),
    rank,
  );
  const picture =
    joins && (container === undefined || container === 'mp4')
      ? bestOf(formats.filter(isPicture), pictureRank)
      : undefined;
  const sound = picture === undefined ? undefined : bestOf(formats.filter(isSound), soundRank);
  if (
    picture !== undefined &&
    sound !== undefined &&
    (best === undefined || isAtLeast([1, picture.height ?? -1, WAY.pair], rank(best)))
  ) {
    return {
      url: picture.url,
      headers: picture.headers,
      kind: 'pair',
      info: { ext: 'mp4', height: picture.height },
      sound: { url: sound.url, headers: sound.headers },
    };
  }
  if (best !== undefined) {
    return {
      url: best.url,
      headers: best.headers,
      kind: kindOf(best),
      // A container of a video: isOneVideoWithSound took no other.
      info: { ext: containerOf(best) as VideoContainer, height: best.height },
    };
  }
  if (formats.length === 0) {
    throw new PageError(PageFailure.Unreadable, 'The page offers no format of the video.');
  }
  // Protected when every format with a picture is: a sound alone that is not protected does not
  // make the video fetchable.
  const pictures = formats.filter((format) => format.vcodec !== 'none');
  if (pictures.length > 0 && pictures.every((format) => format.hasDrm)) {
    throw new PageError(PageFailure.Drm, 'The video is protected.');
  }
  throw new PageError(
    PageFailure.FormatUnsupported,
    'The video is offered only as DASH, or as picture and sound apart in forms Scia does not join.',
  );
}
