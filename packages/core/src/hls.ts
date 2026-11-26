// An HLS playlist read as text (RFC 8216): the pieces of a stream, or the qualities it is offered
// in. Addresses stay as the playlist writes them — relative ones are resolved by whoever fetched
// it, which knows where from.

export const HlsRefusal = {
  // What came back is no playlist: a page, an error, nothing.
  NotAPlaylist: 'HLS_NOT_A_PLAYLIST',
  // A key Scia does not take: SAMPLE-AES, or a key format other than the standard one — DRM
  // (CLAUDE.md, "Respect the hosts").
  Protected: 'HLS_PROTECTED',
} as const;
export type HlsRefusal = (typeof HlsRefusal)[keyof typeof HlsRefusal];

export class HlsError extends Error {
  override readonly name = 'HlsError';
  readonly refusal: HlsRefusal;

  constructor(refusal: HlsRefusal) {
    super(refusal);
    this.refusal = refusal;
  }
}

export interface ByteRange {
  readonly offset: number;
  readonly length: number;
}

// AES-128 with a key anyone the page plays to is given; `iv` in hexadecimal, or null for the
// piece's number.
export interface HlsKey {
  readonly method: 'AES-128';
  readonly uri: string;
  readonly iv: string | null;
  readonly keyFormat: 'identity';
}

export interface HlsSegment {
  readonly uri: string;
  // Seconds.
  readonly duration: number;
  // Its media sequence number, which an AES-128 key without an IV is used with.
  readonly sequence: number;
  readonly key: HlsKey | null;
  // The init segment fragmented mp4 pieces need before them; `keyed` when it was named under a
  // key, which then encrypts it too (RFC 8216, 4.3.2.4).
  readonly map: {
    readonly uri: string;
    readonly byteRange: ByteRange | null;
    readonly keyed: boolean;
  } | null;
  readonly byteRange: ByteRange | null;
  // The stream jumps before this piece: its timestamps or its encoding start again.
  readonly discontinuity: boolean;
}

export interface HlsVariant {
  readonly uri: string;
  readonly bandwidth: number | null;
  readonly height: number | null;
}

export type HlsPlaylist =
  | { readonly kind: 'media'; readonly ends: boolean; readonly segments: readonly HlsSegment[] }
  | { readonly kind: 'master'; readonly variants: readonly HlsVariant[] };

// `KEY=value,KEY="quoted, with commas"`. A name starts the list or follows a character no name
// has: free to start anywhere, a long name never given a value is read again from each of its
// characters, and a site's playlist can make that take seconds (#383).
const ATTRIBUTE = /(?:^|[^A-Z0-9-])([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

function attributesOf(list: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const match of list.matchAll(ATTRIBUTE)) {
    const [, name = '', raw = ''] = match;
    attributes.set(name, raw.startsWith('"') ? raw.slice(1, -1) : raw);
  }
  return attributes;
}

function numberOf(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// A piece lasts from nothing to a day: a length outside that is no stream's, and would make a line
// of time no contract takes.
const LONGEST_PIECE_SECONDS = 24 * 60 * 60;

function lengthOf(text: string | undefined): number {
  const seconds = numberOf(text);
  if (seconds === null || seconds < 0 || seconds > LONGEST_PIECE_SECONDS) {
    throw new HlsError(HlsRefusal.NotAPlaylist);
  }
  return seconds;
}

// `length[@offset]`; with no offset, the range starts where the one before ended.
function byteRangeOf(text: string, after: number): ByteRange | null {
  const match = /^(\d+)(?:@(\d+))?$/.exec(text.trim());
  if (match === null) return null;
  const length = Number(match[1]);
  return { length, offset: match[2] === undefined ? after : Number(match[2]) };
}

function keyOf(attributes: ReadonlyMap<string, string>): HlsKey | null {
  const method = attributes.get('METHOD');
  if (method === undefined || method === 'NONE') return null;
  const keyFormat = attributes.get('KEYFORMAT') ?? 'identity';
  const uri = attributes.get('URI');
  if (method !== 'AES-128' || keyFormat !== 'identity' || uri === undefined) {
    throw new HlsError(HlsRefusal.Protected);
  }
  const iv = attributes.get('IV');
  return {
    method,
    uri,
    iv: iv === undefined ? null : iv.replace(/^0x/i, '').toLowerCase(),
    keyFormat,
  };
}

export function parsePlaylist(text: string): HlsPlaylist {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines[0] !== '#EXTM3U') throw new HlsError(HlsRefusal.NotAPlaylist);

  const segments: HlsSegment[] = [];
  const variants: HlsVariant[] = [];
  let sequence = 0;
  let ends = false;
  let key: HlsKey | null = null;
  let map: HlsSegment['map'] = null;
  let duration: number | null = null;
  let byteRange: ByteRange | null = null;
  let rangeEnd = 0;
  let variant: Omit<HlsVariant, 'uri'> | null = null;
  let discontinuity = false;

  for (const line of lines.slice(1)) {
    if (!line.startsWith('#')) {
      if (variant !== null) {
        variants.push({ uri: line, ...variant });
        variant = null;
      } else if (duration !== null) {
        segments.push({ uri: line, duration, sequence, key, map, byteRange, discontinuity });
        sequence += 1;
        duration = null;
        byteRange = null;
        discontinuity = false;
      }
      continue;
    }
    const colon = line.indexOf(':');
    const tag = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1);
    switch (tag) {
      case '#EXTINF':
        duration = lengthOf(value.split(',')[0]);
        break;
      case '#EXT-X-DISCONTINUITY':
        discontinuity = true;
        break;
      case '#EXT-X-MEDIA-SEQUENCE':
        sequence = numberOf(value) ?? 0;
        break;
      case '#EXT-X-ENDLIST':
        ends = true;
        break;
      case '#EXT-X-KEY':
        key = keyOf(attributesOf(value));
        break;
      // A key named for the whole session is the same refusal when it is DRM.
      case '#EXT-X-SESSION-KEY':
        keyOf(attributesOf(value));
        break;
      case '#EXT-X-MAP': {
        const attributes = attributesOf(value);
        const range = attributes.get('BYTERANGE');
        map = {
          uri: attributes.get('URI') ?? '',
          byteRange: range === undefined ? null : byteRangeOf(range, 0),
          keyed: key !== null,
        };
        break;
      }
      case '#EXT-X-BYTERANGE':
        byteRange = byteRangeOf(value, rangeEnd);
        if (byteRange !== null) rangeEnd = byteRange.offset + byteRange.length;
        break;
      case '#EXT-X-STREAM-INF': {
        const attributes = attributesOf(value);
        const height = /x(\d+)$/.exec(attributes.get('RESOLUTION') ?? '')?.[1];
        variant = {
          bandwidth: numberOf(attributes.get('BANDWIDTH')),
          height: height === undefined ? null : Number(height),
        };
        break;
      }
      default:
        break;
    }
  }
  if (variants.length > 0) return { kind: 'master', variants };
  return { kind: 'media', ends, segments };
}

// The IV of an AES-128 piece: the key's own, or its media sequence number as sixteen bytes, big
// endian (RFC 8216, 5.2).
export function ivOfSegment(key: Pick<HlsKey, 'iv'>, sequence: number): Uint8Array {
  const iv = new Uint8Array(16);
  if (key.iv !== null) {
    const hex = key.iv.padStart(32, '0').slice(-32);
    for (let i = 0; i < 16; i += 1) iv[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return iv;
  }
  let rest = sequence;
  for (let i = 15; i >= 0 && rest > 0; i -= 1) {
    iv[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return iv;
}
