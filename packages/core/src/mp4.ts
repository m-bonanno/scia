// The picture and the sound of a page's video, offered as two mp4 files, made into one mp4 with
// nothing re-encoded (docs/adr/0021): the boxes of ISO/IEC 14496-12 read, the two movies made one
// with two tracks, and the media bytes copied as they are. What is written is planned here, as a
// list of bytes to write and of ranges of either file to copy; the engine reads and writes.

export const Mp4Refusal = {
  // What is not an mp4 as the standard writes one: a box that runs past its file, a movie with
  // no track, a fragment with no data.
  Unreadable: 'unreadable',
  // An mp4, but not one Scia joins: more than one track in a file, a picture with no picture, a
  // fragmented file beside one that is not.
  Unsupported: 'unsupported',
} as const;
export type Mp4Refusal = (typeof Mp4Refusal)[keyof typeof Mp4Refusal];

export class Mp4Error extends Error {
  override readonly name = 'Mp4Error';
  readonly refusal: Mp4Refusal;

  constructor(refusal: Mp4Refusal, message: string) {
    super(message);
    this.refusal = refusal;
  }
}

// A box of a file, where it stands in it.
export interface TopBox {
  readonly type: string;
  readonly start: number;
  readonly size: number;
  readonly headerSize: number;
}

// The boxes the engine reads whole for the plan: the movie, and each fragment's header. The media
// data is never read, only copied.
export const BOXES_READ: ReadonlySet<string> = new Set(['moov', 'moof']);

// One file of the two: its boxes, and the contents of those of BOXES_READ by where they start.
export interface Mp4Source {
  readonly boxes: readonly TopBox[];
  readonly contents: ReadonlyMap<number, Uint8Array>;
}

// What is written, in order: bytes made here, or a range of one of the two files as it stands.
export type Written =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | {
      readonly kind: 'copy';
      readonly from: 'picture' | 'sound';
      readonly start: number;
      readonly end: number;
    };

const unreadable = (message: string) => new Mp4Error(Mp4Refusal.Unreadable, message);
const unsupported = (message: string) => new Mp4Error(Mp4Refusal.Unsupported, message);

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const typeAt = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );

const typeBytes = (type: string) =>
  Uint8Array.from([0, 1, 2, 3].map((index) => type.charCodeAt(index) & 0xff));

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  viewOf(bytes).setUint32(0, value);
  return bytes;
}

function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  viewOf(bytes).setBigUint64(0, BigInt(value));
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

// The header of the box that starts the bytes, of a file with `room` bytes from there to its end.
// A size of 0 is a box that runs to the end of the file.
export function boxHeaderOf(bytes: Uint8Array, room: number): Omit<TopBox, 'start'> {
  if (bytes.byteLength < 8 || room < 8) throw unreadable('A box is cut short.');
  const view = viewOf(bytes);
  const type = typeAt(bytes, 4);
  const small = view.getUint32(0);
  if (small === 1) {
    if (bytes.byteLength < 16 || room < 16) throw unreadable('A box is cut short.');
    const size = Number(view.getBigUint64(8));
    if (size < 16 || size > room) throw unreadable(`The box ${type} does not fit its file.`);
    return { type, size, headerSize: 16 };
  }
  const size = small === 0 ? room : small;
  if (size < 8 || size > room) throw unreadable(`The box ${type} does not fit its file.`);
  return { type, size, headerSize: 8 };
}

// A box with its header, around the parts given.
export function boxOf(type: string, ...parts: readonly Uint8Array[]): Uint8Array {
  const payload = concat(parts);
  const size = payload.byteLength + 8;
  if (size > 0xffffffff) return concat([u32(1), typeBytes(type), u64(size + 8), payload]);
  return concat([u32(size), typeBytes(type), payload]);
}

// The boxes inside a box that holds boxes (`moov`, `trak`, …), each with its header.
export function childrenOf(box: Uint8Array): Uint8Array[] {
  const { headerSize, size } = boxHeaderOf(box, box.byteLength);
  const children: Uint8Array[] = [];
  let offset = headerSize;
  while (offset < size) {
    const child = boxHeaderOf(box.subarray(offset, size), size - offset);
    children.push(box.subarray(offset, offset + child.size));
    offset += child.size;
  }
  return children;
}

const typeOf = (box: Uint8Array) => typeAt(box, 4);
const payloadStart = (box: Uint8Array) => boxHeaderOf(box, box.byteLength).headerSize;

function childOf(box: Uint8Array, type: string): Uint8Array | undefined {
  return childrenOf(box).find((child) => typeOf(child) === type);
}

function needChild(box: Uint8Array, type: string): Uint8Array {
  const child = childOf(box, type);
  if (child === undefined) throw unreadable(`The box ${typeOf(box)} has no ${type}.`);
  return child;
}

// The box rebuilt with each child given to `edit`: the boxes around a changed one take its size.
function rebuilt(box: Uint8Array, edit: (child: Uint8Array) => Uint8Array): Uint8Array {
  return boxOf(typeOf(box), ...childrenOf(box).map(edit));
}

// A full box's version, read after its header.
const versionOf = (box: Uint8Array) => box[payloadStart(box)] ?? 0;

// A copy of the box to edit in place: its size does not change.
const copyOf = (box: Uint8Array) => Uint8Array.from(box);

function readWide(view: DataView, offset: number, wide: boolean): number {
  return wide ? Number(view.getBigUint64(offset)) : view.getUint32(offset);
}

function writeWide(view: DataView, offset: number, wide: boolean, value: number): void {
  if (wide) {
    view.setBigUint64(offset, BigInt(value));
    return;
  }
  if (value > 0xffffffff) throw unsupported('A duration does not fit its box.');
  view.setUint32(offset, value);
}

const rescaled = (value: number, from: number, to: number) =>
  from === to ? value : Math.round((value * to) / from);

// mvhd, tkhd, mdhd: where the timescale and the duration stand, by version.
function timesOf(box: Uint8Array): { readonly timescale: number; readonly duration: number } {
  const start = payloadStart(box);
  const wide = versionOf(box) === 1;
  const view = viewOf(box);
  const at = start + 4 + (wide ? 16 : 8);
  return { timescale: view.getUint32(at), duration: readWide(view, at + 4, wide) };
}

function handlerOf(trak: Uint8Array): string {
  const hdlr = needChild(needChild(trak, 'mdia'), 'hdlr');
  return typeAt(hdlr, payloadStart(hdlr) + 8);
}

function trackIdOf(tkhd: Uint8Array): number {
  const wide = versionOf(tkhd) === 1;
  return viewOf(tkhd).getUint32(payloadStart(tkhd) + 4 + (wide ? 16 : 8));
}

// The movie of one file: its single track, and what the join needs of it.
export interface Movie {
  readonly mvhd: Uint8Array;
  readonly timescale: number;
  readonly duration: number;
  readonly trak: Uint8Array;
  readonly trackId: number;
  readonly handler: string;
  // The track's own timescale (`mdhd`), in which its fragments count time.
  readonly mediaTimescale: number;
  // A fragmented movie's defaults for its track's fragments, and its length when it says.
  readonly trex: Uint8Array | undefined;
  readonly fragmentDuration: number | undefined;
  readonly fragmented: boolean;
  // How many samples its own tables hold: all of them for a movie that is not fragmented, none
  // for most that are.
  readonly samples: number;
}

// The samples a track's tables hold, by their sizes (`stsz`, or the compact `stz2`).
function samplesOf(trak: Uint8Array): number {
  const stbl = needChild(needChild(needChild(trak, 'mdia'), 'minf'), 'stbl');
  const sizes = childOf(stbl, 'stsz') ?? childOf(stbl, 'stz2');
  if (sizes === undefined) return 0;
  return viewOf(sizes).getUint32(payloadStart(sizes) + 8);
}

export function movieOf(moov: Uint8Array): Movie {
  const mvhd = needChild(moov, 'mvhd');
  const traks = childrenOf(moov).filter((child) => typeOf(child) === 'trak');
  const [trak] = traks;
  if (trak === undefined) throw unreadable('The movie has no track.');
  if (traks.length > 1) throw unsupported('A file of the two has more than one track.');
  const trackId = trackIdOf(needChild(trak, 'tkhd'));
  const mvex = childOf(moov, 'mvex');
  const trexOfTrack =
    mvex === undefined
      ? undefined
      : childrenOf(mvex).find(
          (child) =>
            typeOf(child) === 'trex' &&
            viewOf(child).getUint32(payloadStart(child) + 4) === trackId,
        );
  const mehd = mvex === undefined ? undefined : childOf(mvex, 'mehd');
  const { timescale, duration } = timesOf(mvhd);
  if (timescale === 0) throw unreadable('The movie has no timescale.');
  const mediaTimescale = timesOf(needChild(needChild(trak, 'mdia'), 'mdhd')).timescale;
  if (mediaTimescale === 0) throw unreadable('The track has no timescale.');
  return {
    mvhd,
    timescale,
    duration,
    trak,
    trackId,
    handler: handlerOf(trak),
    mediaTimescale,
    trex: trexOfTrack,
    fragmentDuration:
      mehd === undefined
        ? undefined
        : readWide(viewOf(mehd), payloadStart(mehd) + 4, versionOf(mehd) === 1),
    fragmented: mvex !== undefined,
    samples: samplesOf(trak),
  };
}

interface TrackChange {
  readonly trackId: number;
  // From the file's movie timescale into the joined movie's.
  readonly from: number;
  readonly to: number;
  // Where each chunk of the track's media stands in the joined file, and whether its offsets are
  // written on 64 bits.
  readonly chunkAt: (offset: number) => number;
  readonly wideOffsets: boolean;
}

function tkhdWith(tkhd: Uint8Array, change: TrackChange): Uint8Array {
  const box = copyOf(tkhd);
  const view = viewOf(box);
  const wide = versionOf(box) === 1;
  const at = payloadStart(box) + 4 + (wide ? 16 : 8);
  view.setUint32(at, change.trackId);
  const durationAt = at + 8;
  writeWide(
    view,
    durationAt,
    wide,
    rescaled(readWide(view, durationAt, wide), change.from, change.to),
  );
  return box;
}

// An edit list counts its segments in the movie's timescale and its media times in the track's.
function elstWith(elst: Uint8Array, change: TrackChange): Uint8Array {
  const box = copyOf(elst);
  const view = viewOf(box);
  const wide = versionOf(box) === 1;
  const start = payloadStart(box) + 4;
  const count = view.getUint32(start);
  const entry = wide ? 20 : 12;
  if (start + 4 + count * entry > box.byteLength) throw unreadable('An edit list is cut short.');
  for (let index = 0; index < count; index += 1) {
    const at = start + 4 + index * entry;
    writeWide(view, at, wide, rescaled(readWide(view, at, wide), change.from, change.to));
  }
  return box;
}

function chunkOffsetsWith(box: Uint8Array, change: TrackChange): Uint8Array {
  const wide = typeOf(box) === 'co64';
  const view = viewOf(box);
  const start = payloadStart(box) + 4;
  const count = view.getUint32(start);
  const entry = wide ? 8 : 4;
  if (start + 4 + count * entry > box.byteLength) throw unreadable('A chunk table is cut short.');
  const offsets: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = change.chunkAt(readWide(view, start + 4 + index * entry, wide));
    if (!change.wideOffsets && offset > 0xffffffff) throw unsupported('An offset does not fit.');
    offsets.push(change.wideOffsets ? u64(offset) : u32(offset));
  }
  return boxOf(change.wideOffsets ? 'co64' : 'stco', u32(0), u32(count), ...offsets);
}

function trakWith(trak: Uint8Array, change: TrackChange): Uint8Array {
  return rebuilt(trak, (child) => {
    switch (typeOf(child)) {
      case 'tkhd':
        return tkhdWith(child, change);
      case 'edts':
        return rebuilt(child, (entry) =>
          typeOf(entry) === 'elst' ? elstWith(entry, change) : entry,
        );
      case 'mdia':
        return rebuilt(child, (mdiaChild) =>
          typeOf(mdiaChild) !== 'minf'
            ? mdiaChild
            : rebuilt(mdiaChild, (minfChild) =>
                typeOf(minfChild) !== 'stbl'
                  ? minfChild
                  : rebuilt(minfChild, (table) =>
                      typeOf(table) === 'stco' || typeOf(table) === 'co64'
                        ? chunkOffsetsWith(table, change)
                        : table,
                    ),
              ),
        );
      default:
        return child;
    }
  });
}

const PICTURE_ID = 1;
const SOUND_ID = 2;

function trexWith(trex: Uint8Array, trackId: number): Uint8Array {
  const box = copyOf(trex);
  viewOf(box).setUint32(payloadStart(box) + 4, trackId);
  return box;
}

// The joined movie: the picture's header, its track as track 1 and the sound's as track 2,
// their lengths in the picture's timescale.
function joinedMoov(
  picture: Movie,
  sound: Movie,
  chunks: {
    readonly picture: (offset: number) => number;
    readonly sound: (offset: number) => number;
  },
  wideOffsets: boolean,
): Uint8Array {
  const to = picture.timescale;
  const mvhd = copyOf(picture.mvhd);
  const mvhdView = viewOf(mvhd);
  const wide = versionOf(mvhd) === 1;
  const durationAt = payloadStart(mvhd) + 4 + (wide ? 16 : 8) + 4;
  writeWide(
    mvhdView,
    durationAt,
    wide,
    Math.max(picture.duration, rescaled(sound.duration, sound.timescale, to)),
  );
  // The next free track id, the last field of the box.
  mvhdView.setUint32(mvhd.byteLength - 4, SOUND_ID + 1);
  const tracks = [
    trakWith(picture.trak, {
      trackId: PICTURE_ID,
      from: picture.timescale,
      to,
      chunkAt: chunks.picture,
      wideOffsets,
    }),
    trakWith(sound.trak, {
      trackId: SOUND_ID,
      from: sound.timescale,
      to,
      chunkAt: chunks.sound,
      wideOffsets,
    }),
  ];
  if (!picture.fragmented) return boxOf('moov', mvhd, ...tracks);
  const lengths = [
    picture.fragmentDuration,
    sound.fragmentDuration === undefined
      ? undefined
      : rescaled(sound.fragmentDuration, sound.timescale, to),
  ].filter((length) => length !== undefined);
  const extends_ = [
    ...(lengths.length === 0 ? [] : [boxOf('mehd', u32(0x01000000), u64(Math.max(...lengths)))]),
    picture.trex === undefined ? defaultTrex(PICTURE_ID) : trexWith(picture.trex, PICTURE_ID),
    sound.trex === undefined ? defaultTrex(SOUND_ID) : trexWith(sound.trex, SOUND_ID),
  ];
  return boxOf('moov', mvhd, ...tracks, boxOf('mvex', ...extends_));
}

const defaultTrex = (trackId: number) =>
  boxOf('trex', u32(0), u32(trackId), u32(1), u32(0), u32(0), u32(0));

function ftypOf(fragmented: boolean): Uint8Array {
  const brands = ['isom', 'iso2', ...(fragmented ? ['iso6'] : []), 'mp41'];
  return boxOf('ftyp', typeBytes('isom'), u32(0x200), ...brands.map(typeBytes));
}

// --- fragments ---

interface Fragment {
  readonly moof: Uint8Array;
  readonly start: number;
  // The end of its mdat: what follows the moof up to there is copied as it stands.
  readonly end: number;
  // When it starts, in seconds of the track: what orders the two tracks' fragments.
  readonly at: number;
}

const TFHD_BASE_DATA_OFFSET = 0x01;
const TFHD_SAMPLE_DESCRIPTION = 0x02;
const TFHD_DEFAULT_DURATION = 0x08;
const TRUN_DATA_OFFSET = 0x01;
const TRUN_FIRST_FLAGS = 0x04;
const TRUN_DURATION = 0x100;
const TRUN_SIZE = 0x200;
const TRUN_FLAGS = 0x400;
const TRUN_COMPOSITION = 0x800;

const flagsOf = (box: Uint8Array) => viewOf(box).getUint32(payloadStart(box)) & 0xffffff;

function trafOf(moof: Uint8Array): Uint8Array {
  const trafs = childrenOf(moof).filter((child) => typeOf(child) === 'traf');
  const [traf] = trafs;
  if (traf === undefined || trafs.length > 1) throw unreadable('A fragment is not of one track.');
  return traf;
}

// How long a fragment lasts, in its track's timescale: each sample's own duration, or the
// fragment's default, or the movie's.
function durationOf(traf: Uint8Array, movieDefault: number): number {
  const tfhd = needChild(traf, 'tfhd');
  const tfhdFlags = flagsOf(tfhd);
  let defaultDuration = movieDefault;
  if ((tfhdFlags & TFHD_DEFAULT_DURATION) !== 0) {
    let at = payloadStart(tfhd) + 8;
    if ((tfhdFlags & TFHD_BASE_DATA_OFFSET) !== 0) at += 8;
    if ((tfhdFlags & TFHD_SAMPLE_DESCRIPTION) !== 0) at += 4;
    defaultDuration = viewOf(tfhd).getUint32(at);
  }
  let total = 0;
  for (const trun of childrenOf(traf).filter((child) => typeOf(child) === 'trun')) {
    const flags = flagsOf(trun);
    const view = viewOf(trun);
    const count = view.getUint32(payloadStart(trun) + 4);
    if ((flags & TRUN_DURATION) === 0) {
      total += count * defaultDuration;
      continue;
    }
    let at = payloadStart(trun) + 8;
    if ((flags & TRUN_DATA_OFFSET) !== 0) at += 4;
    if ((flags & TRUN_FIRST_FLAGS) !== 0) at += 4;
    const fields = [TRUN_DURATION, TRUN_SIZE, TRUN_FLAGS, TRUN_COMPOSITION].filter(
      (field) => (flags & field) !== 0,
    ).length;
    if (at + count * fields * 4 > trun.byteLength) throw unreadable('A fragment is cut short.');
    for (let index = 0; index < count; index += 1) {
      total += view.getUint32(at + index * fields * 4);
    }
  }
  return total;
}

function fragmentsOf(source: Mp4Source, movie: Movie): Fragment[] {
  const trexDuration =
    movie.trex === undefined ? 0 : viewOf(movie.trex).getUint32(payloadStart(movie.trex) + 12);
  const fragments: Fragment[] = [];
  let pending: { readonly moof: Uint8Array; readonly start: number } | undefined;
  let next = 0;
  for (const box of source.boxes) {
    if (box.type === 'moof') {
      if (pending !== undefined) throw unreadable('A fragment has no data.');
      const moof = source.contents.get(box.start);
      if (moof === undefined) throw unreadable('A fragment was not read.');
      pending = { moof, start: box.start };
    } else if (box.type === 'mdat' && pending !== undefined) {
      const traf = trafOf(pending.moof);
      const tfhd = needChild(traf, 'tfhd');
      if (viewOf(tfhd).getUint32(payloadStart(tfhd) + 4) !== movie.trackId) {
        throw unreadable('A fragment is of another track.');
      }
      const tfdt = childOf(traf, 'tfdt');
      const decodeTime =
        tfdt === undefined
          ? next
          : readWide(viewOf(tfdt), payloadStart(tfdt) + 4, versionOf(tfdt) === 1);
      next = decodeTime + durationOf(traf, trexDuration);
      fragments.push({
        moof: pending.moof,
        start: pending.start,
        end: box.start + box.size,
        at: decodeTime / movie.mediaTimescale,
      });
      pending = undefined;
    } else if (box.type === 'mdat') {
      // Media data no fragment names: the movie's own samples, which the plan does not copy.
      throw unsupported('A fragmented file has media data outside its fragments.');
    }
  }
  if (pending !== undefined) throw unreadable('A fragment has no data.');
  return fragments;
}

// The fragment's header in the joined file: its track's new id, its place in the sequence, and —
// when it says where its data is from the start of the file — that place moved by `shift`.
function moofWith(moof: Uint8Array, trackId: number, sequence: number, shift: number): Uint8Array {
  return rebuilt(moof, (child) => {
    if (typeOf(child) === 'mfhd') {
      const box = copyOf(child);
      viewOf(box).setUint32(payloadStart(box) + 4, sequence);
      return box;
    }
    if (typeOf(child) !== 'traf') return child;
    return rebuilt(child, (entry) => {
      if (typeOf(entry) !== 'tfhd') return entry;
      const box = copyOf(entry);
      const view = viewOf(box);
      view.setUint32(payloadStart(box) + 4, trackId);
      if ((flagsOf(box) & TFHD_BASE_DATA_OFFSET) !== 0) {
        const at = payloadStart(box) + 8;
        view.setBigUint64(at, BigInt(Number(view.getBigUint64(at)) + shift));
      }
      return box;
    });
  });
}

function movieIn(source: Mp4Source): Movie {
  const boxes = source.boxes.filter((box) => box.type === 'moov');
  const [box] = boxes;
  if (box === undefined || boxes.length > 1) throw unreadable('A file has no movie, or two.');
  const moov = source.contents.get(box.start);
  if (moov === undefined) throw unreadable('A movie was not read.');
  return movieOf(moov);
}

function fragmentedPlan(
  pictureSource: Mp4Source,
  picture: Movie,
  soundSource: Mp4Source,
  sound: Movie,
): Written[] {
  const ftyp = ftypOf(true);
  // A fragmented movie keeps no chunk of its own: its tables are empty.
  const moov = joinedMoov(picture, sound, { picture: (o) => o, sound: (o) => o }, false);
  const tagged = [
    ...fragmentsOf(pictureSource, picture).map((fragment) => ({
      fragment,
      from: 'picture' as const,
    })),
    ...fragmentsOf(soundSource, sound).map((fragment) => ({ fragment, from: 'sound' as const })),
  ];
  // By when each starts; the picture's first at the same time. Sorting is stable.
  tagged.sort((a, b) => a.fragment.at - b.fragment.at);
  const written: Written[] = [
    { kind: 'bytes', bytes: ftyp },
    { kind: 'bytes', bytes: moov },
  ];
  let position = ftyp.byteLength + moov.byteLength;
  let sequence = 1;
  for (const { fragment, from } of tagged) {
    const moof = moofWith(
      fragment.moof,
      from === 'picture' ? PICTURE_ID : SOUND_ID,
      sequence,
      position - fragment.start,
    );
    sequence += 1;
    const dataStart = fragment.start + fragment.moof.byteLength;
    written.push(
      { kind: 'bytes', bytes: moof },
      { kind: 'copy', from, start: dataStart, end: fragment.end },
    );
    position += moof.byteLength + (fragment.end - dataStart);
  }
  return written;
}

// --- a movie that is not fragmented ---

interface Range {
  readonly start: number;
  readonly end: number;
}

// The media data of a file: the payload of each of its mdat boxes.
function mediaOf(source: Mp4Source): Range[] {
  return source.boxes
    .filter((box) => box.type === 'mdat')
    .map((box) => ({ start: box.start + box.headerSize, end: box.start + box.size }));
}

// Where a chunk of a file lands once its media data is copied from `at` on: a chunk outside its
// media data is no chunk.
function chunkMap(media: readonly Range[], at: number): (offset: number) => number {
  return (offset) => {
    let before = at;
    for (const range of media) {
      if (offset >= range.start && offset < range.end) return before + (offset - range.start);
      before += range.end - range.start;
    }
    throw unreadable('A chunk is outside its media data.');
  };
}

function progressivePlan(
  pictureSource: Mp4Source,
  picture: Movie,
  soundSource: Mp4Source,
  sound: Movie,
): Written[] {
  const ftyp = ftypOf(false);
  const pictureMedia = mediaOf(pictureSource);
  const soundMedia = mediaOf(soundSource);
  const length = (ranges: readonly Range[]) =>
    ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  const payload = length(pictureMedia) + length(soundMedia);
  const mdatHeader = payload + 8 > 0xffffffff ? 16 : 8;
  // The movie's size depends on how wide its offsets are, never on their values.
  const sized = (wide: boolean) =>
    joinedMoov(picture, sound, { picture: () => 0, sound: () => 0 }, wide).byteLength;
  const narrowEnd = ftyp.byteLength + sized(false) + mdatHeader + payload;
  const wide = narrowEnd > 0xffffffff;
  const dataAt = ftyp.byteLength + sized(wide) + mdatHeader;
  const moov = joinedMoov(
    picture,
    sound,
    {
      picture: chunkMap(pictureMedia, dataAt),
      sound: chunkMap(soundMedia, dataAt + length(pictureMedia)),
    },
    wide,
  );
  const header =
    mdatHeader === 16
      ? concat([u32(1), typeBytes('mdat'), u64(payload + 16)])
      : concat([u32(payload + 8), typeBytes('mdat')]);
  return [
    { kind: 'bytes', bytes: ftyp },
    { kind: 'bytes', bytes: moov },
    { kind: 'bytes', bytes: header },
    ...pictureMedia.map((range) => ({ kind: 'copy' as const, from: 'picture' as const, ...range })),
    ...soundMedia.map((range) => ({ kind: 'copy' as const, from: 'sound' as const, ...range })),
  ];
}

// The joined mp4, as what is written in order: the picture's track first, the sound's second, the
// media bytes of both as they are.
export function joinPlan(pictureSource: Mp4Source, soundSource: Mp4Source): Written[] {
  try {
    const picture = movieIn(pictureSource);
    const sound = movieIn(soundSource);
    if (picture.handler !== 'vide') throw unsupported('The picture is not a picture.');
    if (sound.handler !== 'soun') throw unsupported('The sound is not sound.');
    if (picture.fragmented !== sound.fragmented) {
      throw unsupported('One file is fragmented and the other is not.');
    }
    // A fragmented movie may keep its first samples in its own tables, before any fragment
    // (ISO/IEC 14496-12 allows it; ffmpeg writes it without `empty_moov`). The plan copies
    // fragments only: such a file is not joined, rather than joined without them.
    if (picture.fragmented && (picture.samples > 0 || sound.samples > 0)) {
      throw unsupported('A fragmented file keeps samples in its movie.');
    }
    return picture.fragmented
      ? fragmentedPlan(pictureSource, picture, soundSource, sound)
      : progressivePlan(pictureSource, picture, soundSource, sound);
  } catch (error) {
    // A box too short for the fields it must hold is read past its end.
    if (error instanceof RangeError) throw unreadable('A box is too short for what it holds.');
    throw error;
  }
}
