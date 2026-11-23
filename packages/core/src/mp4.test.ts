import { describe, expect, it } from 'vitest';
import {
  boxHeaderOf,
  boxOf,
  childrenOf,
  joinPlan,
  Mp4Error,
  Mp4Refusal,
  type Mp4Source,
  movieOf,
  type TopBox,
  type Written,
} from './mp4.ts';

// --- boxes as the standard writes them, small enough to read in a spec ---

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  view(bytes).setUint32(0, value);
  return bytes;
}

function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  view(bytes).setBigUint64(0, BigInt(value));
  return bytes;
}

const zeros = (length: number) => new Uint8Array(length);
const versionAndFlags = (version: number, flags: number) => u32(version * 0x1000000 + flags);
const ascii = (text: string) =>
  Uint8Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));

const mvhd = (timescale: number, duration: number) =>
  boxOf(
    'mvhd',
    versionAndFlags(0, 0),
    u32(0),
    u32(0),
    u32(timescale),
    u32(duration),
    zeros(76),
    u32(9),
  );
const tkhd = (id: number, duration: number) =>
  boxOf('tkhd', versionAndFlags(0, 3), u32(0), u32(0), u32(id), u32(0), u32(duration), zeros(60));
const mdhd = (timescale: number) =>
  boxOf('mdhd', versionAndFlags(0, 0), u32(0), u32(0), u32(timescale), u32(0), zeros(4));
const hdlr = (handler: string) =>
  boxOf('hdlr', versionAndFlags(0, 0), u32(0), ascii(handler), zeros(12), zeros(1));
// A file past 4 GiB writes its chunks' offsets on 64 bits.
const stco = (offsets: readonly number[]) =>
  offsets.some((offset) => offset > 0xffffffff)
    ? boxOf('co64', versionAndFlags(0, 0), u32(offsets.length), ...offsets.map(u64))
    : boxOf('stco', versionAndFlags(0, 0), u32(offsets.length), ...offsets.map(u32));
const elst = (segmentDuration: number) =>
  boxOf('elst', versionAndFlags(0, 0), u32(1), u32(segmentDuration), u32(0), u32(0x10000));

interface TrackOf {
  readonly id: number;
  readonly handler: string;
  readonly mediaTimescale: number;
  readonly duration?: number;
  readonly offsets?: readonly number[];
  readonly edit?: number;
  // How many samples its own tables hold (`stsz`).
  readonly samples?: number;
}

const trak = (track: TrackOf) =>
  boxOf(
    'trak',
    tkhd(track.id, track.duration ?? 0),
    ...(track.edit === undefined ? [] : [boxOf('edts', elst(track.edit))]),
    boxOf(
      'mdia',
      mdhd(track.mediaTimescale),
      hdlr(track.handler),
      boxOf(
        'minf',
        boxOf(
          'stbl',
          boxOf('stsz', versionAndFlags(0, 0), u32(0), u32(track.samples ?? 0)),
          stco(track.offsets ?? []),
        ),
      ),
    ),
  );

const trex = (id: number, defaultDuration: number) =>
  boxOf('trex', versionAndFlags(0, 0), u32(id), u32(1), u32(defaultDuration), u32(0), u32(0));
const mehd = (length: number) => boxOf('mehd', versionAndFlags(0, 0), u32(length));

const moov = (timescale: number, duration: number, tracks: readonly TrackOf[], mvex?: Uint8Array) =>
  boxOf(
    'moov',
    mvhd(timescale, duration),
    ...tracks.map(trak),
    ...(mvex === undefined ? [] : [mvex]),
  );

interface FragmentOf {
  readonly trackId: number;
  readonly decodeTime?: number;
  // Each sample's duration, or `count` samples of the fragment's default.
  readonly durations?: readonly number[];
  readonly count?: number;
  readonly defaultDuration?: number;
  readonly baseDataOffset?: number;
}

const DEFAULT_BASE_IS_MOOF = 0x020000;

function moof(sequence: number, fragment: FragmentOf): Uint8Array {
  const tfhdFlags =
    (fragment.baseDataOffset === undefined ? DEFAULT_BASE_IS_MOOF : 0x01) |
    (fragment.defaultDuration === undefined ? 0 : 0x08);
  const tfhd = boxOf(
    'tfhd',
    versionAndFlags(0, tfhdFlags),
    u32(fragment.trackId),
    ...(fragment.baseDataOffset === undefined ? [] : [u64(fragment.baseDataOffset)]),
    ...(fragment.defaultDuration === undefined ? [] : [u32(fragment.defaultDuration)]),
  );
  const durations = fragment.durations;
  const trun =
    durations === undefined
      ? boxOf('trun', versionAndFlags(0, 0x01), u32(fragment.count ?? 1), u32(0))
      : boxOf(
          'trun',
          versionAndFlags(0, 0x101),
          u32(durations.length),
          u32(0),
          ...durations.map(u32),
        );
  const tfdt =
    fragment.decodeTime === undefined
      ? []
      : [boxOf('tfdt', versionAndFlags(1, 0), u64(fragment.decodeTime))];
  return boxOf(
    'moof',
    boxOf('mfhd', versionAndFlags(0, 0), u32(sequence)),
    boxOf('traf', tfhd, ...tfdt, trun),
  );
}

// A file laid out box after box: the bytes of a box, or only the size of one whose bytes the plan
// never reads (an mdat, a sidx).
type Laid = Uint8Array | { readonly type: string; readonly size: number };

function laidOut(...parts: readonly Laid[]): Mp4Source {
  const boxes: TopBox[] = [];
  const contents = new Map<number, Uint8Array>();
  let start = 0;
  for (const part of parts) {
    if (part instanceof Uint8Array) {
      const header = boxHeaderOf(part, part.byteLength);
      boxes.push({ ...header, start });
      contents.set(start, part);
      start += part.byteLength;
    } else {
      boxes.push({ type: part.type, size: part.size, headerSize: 8, start });
      start += part.size;
    }
  }
  return { boxes, contents };
}

const startOf = (source: Mp4Source, index: number) => source.boxes[index]!.start;

// --- reading what the plan wrote ---

const typeOf = (box: Uint8Array) => String.fromCharCode(...box.subarray(4, 8));

function child(box: Uint8Array, ...path: readonly string[]): Uint8Array {
  let at = box;
  for (const type of path) {
    const found = childrenOf(at).find((entry) => typeOf(entry) === type);
    if (found === undefined) throw new Error(`no ${type}`);
    at = found;
  }
  return at;
}

const children = (box: Uint8Array, type: string) =>
  childrenOf(box).filter((entry) => typeOf(entry) === type);

const bytesOf = (written: Written | undefined) => {
  if (written?.kind !== 'bytes') throw new Error('not bytes');
  return written.bytes;
};

const field = (box: Uint8Array, at: number) => view(box).getUint32(8 + at);
const trackId = (trakBox: Uint8Array) => field(child(trakBox, 'tkhd'), 12);
const trackDuration = (trakBox: Uint8Array) => field(child(trakBox, 'tkhd'), 20);

function offsetsOf(trakBox: Uint8Array): number[] {
  const stbl = child(trakBox, 'mdia', 'minf', 'stbl');
  const table = childrenOf(stbl).find((entry) => ['stco', 'co64'].includes(typeOf(entry)))!;
  const wide = typeOf(table) === 'co64';
  const count = field(table, 4);
  return Array.from({ length: count }, (_, index) =>
    wide ? Number(view(table).getBigUint64(16 + index * 8)) : field(table, 8 + index * 4),
  );
}

function refusalOf(attempt: () => unknown): Mp4Refusal | undefined {
  try {
    attempt();
  } catch (error) {
    if (error instanceof Mp4Error) return error.refusal;
    throw error;
  }
  return undefined;
}

const FTYP = boxOf('ftyp', ascii('isom'), u32(0x200), ascii('isom'));

// --- the specs ---

describe('boxHeaderOf', () => {
  it('reads a box by its 32-bit size and its type', () => {
    expect(boxHeaderOf(Uint8Array.from([0, 0, 0, 24, ...ascii('ftyp')]), 100)).toEqual({
      type: 'ftyp',
      size: 24,
      headerSize: 8,
    });
  });

  it('reads the 64-bit size of a box that says 1, and a box that says 0 runs to the end', () => {
    const large = Uint8Array.from([0, 0, 0, 1, ...ascii('mdat'), ...u64(6_000_000_000)]);
    expect(boxHeaderOf(large, 7_000_000_000)).toEqual({
      type: 'mdat',
      size: 6_000_000_000,
      headerSize: 16,
    });
    expect(boxHeaderOf(Uint8Array.from([0, 0, 0, 0, ...ascii('mdat')]), 500).size).toBe(500);
  });

  it('refuses a box smaller than its header, longer than its file, or cut short', () => {
    expect(refusalOf(() => boxHeaderOf(Uint8Array.from([0, 0, 0, 4, ...ascii('free')]), 100))).toBe(
      Mp4Refusal.Unreadable,
    );
    expect(
      refusalOf(() => boxHeaderOf(Uint8Array.from([0, 0, 0, 200, ...ascii('free')]), 100)),
    ).toBe(Mp4Refusal.Unreadable);
    expect(refusalOf(() => boxHeaderOf(Uint8Array.from([0, 0, 0]), 100))).toBe(
      Mp4Refusal.Unreadable,
    );
  });
});

describe('boxOf and childrenOf', () => {
  it('puts boxes in a box and reads them back, each with its header', () => {
    const inner = boxOf('free', Uint8Array.from([1, 2, 3]));
    const outer = boxOf('moov', inner, boxOf('skip'));

    expect(view(outer).getUint32(0)).toBe(outer.byteLength);
    expect(childrenOf(outer).map(typeOf)).toEqual(['free', 'skip']);
    expect([...childrenOf(outer)[0]!]).toEqual([...inner]);
  });
});

describe('movieOf', () => {
  it('reads the one track of a file, its handler and both timescales', () => {
    const movie = movieOf(moov(1000, 3000, [{ id: 7, handler: 'soun', mediaTimescale: 44_100 }]));

    expect(movie).toMatchObject({
      timescale: 1000,
      duration: 3000,
      trackId: 7,
      handler: 'soun',
      mediaTimescale: 44_100,
      fragmented: false,
    });
  });

  it("reads a fragmented movie's defaults for its track and its length", () => {
    const movie = movieOf(
      moov(
        1000,
        0,
        [{ id: 1, handler: 'vide', mediaTimescale: 90_000 }],
        boxOf('mvex', mehd(3000), trex(1, 3000)),
      ),
    );

    expect(movie.fragmented).toBe(true);
    expect(movie.fragmentDuration).toBe(3000);
    expect(movie.trex).toBeDefined();
  });

  it('refuses a movie with two tracks as one Scia does not join, and one with none as unreadable', () => {
    const two = [
      { id: 1, handler: 'vide', mediaTimescale: 1 },
      { id: 2, handler: 'soun', mediaTimescale: 1 },
    ];
    expect(refusalOf(() => movieOf(moov(1000, 0, two)))).toBe(Mp4Refusal.Unsupported);
    expect(refusalOf(() => movieOf(moov(1000, 0, [])))).toBe(Mp4Refusal.Unreadable);
  });
});

describe('joinPlan, for two movies that are not fragmented', () => {
  // The picture: its media in one mdat of 100 bytes, two chunks in it. The sound: two mdats of 30
  // and 20 bytes, a chunk in each.
  function sources() {
    const pictureMoov = (at: number) =>
      moov(1000, 3000, [
        { id: 1, handler: 'vide', mediaTimescale: 15_360, duration: 3000, offsets: [at, at + 60] },
      ]);
    const pictureMdatAt = FTYP.byteLength + pictureMoov(0).byteLength;
    const picture = laidOut(FTYP, pictureMoov(pictureMdatAt + 8), { type: 'mdat', size: 108 });
    const soundMoov = (first: number, second: number) =>
      moov(44_100, 132_300, [
        {
          id: 1,
          handler: 'soun',
          mediaTimescale: 44_100,
          duration: 132_300,
          offsets: [first, second],
          edit: 132_300,
        },
      ]);
    const soundMdatAt = FTYP.byteLength + soundMoov(0, 0).byteLength;
    const sound = laidOut(
      FTYP,
      soundMoov(soundMdatAt + 8, soundMdatAt + 38 + 8),
      { type: 'mdat', size: 38 },
      { type: 'mdat', size: 28 },
    );
    return { picture, sound };
  }

  it("writes the movie, then the picture's media and the sound's, as they stand", () => {
    const { picture, sound } = sources();
    const plan = joinPlan(picture, sound);

    expect(
      plan.map((written) => (written.kind === 'bytes' ? typeOf(written.bytes) : written.from)),
    ).toEqual(['ftyp', 'moov', 'mdat', 'picture', 'sound', 'sound']);
    const mdatStart = startOf(picture, 2);
    expect(plan[3]).toEqual({
      kind: 'copy',
      from: 'picture',
      start: mdatStart + 8,
      end: mdatStart + 108,
    });
    expect(view(bytesOf(plan[2])).getUint32(0)).toBe(8 + 100 + 30 + 20);
  });

  it('moves every chunk to where its bytes are copied', () => {
    const { picture, sound } = sources();
    const plan = joinPlan(picture, sound);
    const joined = bytesOf(plan[1]);
    const dataAt = bytesOf(plan[0]).byteLength + joined.byteLength + 8;
    const [pictureTrak, soundTrak] = children(joined, 'trak');

    expect(offsetsOf(pictureTrak!)).toEqual([dataAt, dataAt + 60]);
    // The sound's second chunk is the first byte of its second mdat: after the first's 30.
    expect(offsetsOf(soundTrak!)).toEqual([dataAt + 100, dataAt + 100 + 30]);
  });

  it("numbers the picture's track 1 and the sound's 2, in the picture's timescale", () => {
    const { picture, sound } = sources();
    const joined = bytesOf(joinPlan(picture, sound)[1]);
    const [pictureTrak, soundTrak] = children(joined, 'trak');

    expect([trackId(pictureTrak!), trackId(soundTrak!)]).toEqual([1, 2]);
    expect(trackDuration(soundTrak!)).toBe(3000);
    expect(field(child(soundTrak!, 'edts', 'elst'), 8)).toBe(3000);
    // The movie lasts as long as its longer track, and its next free track is 3.
    const header = child(joined, 'mvhd');
    expect(field(header, 16)).toBe(3000);
    expect(view(header).getUint32(header.byteLength - 4)).toBe(3);
  });

  it('writes 64-bit offsets and a 64-bit mdat when the file passes 4 GiB', () => {
    // A chunk at the start of a first mdat of 100 bytes, and one near the end of a second of 5 GiB.
    const big = 5 * 1024 ** 3;
    const pictureMoov = (offsets: readonly number[]) =>
      moov(1000, 0, [{ id: 1, handler: 'vide', mediaTimescale: 1000, offsets }]);
    const mediaAt = FTYP.byteLength + pictureMoov([0, big]).byteLength + 8;
    const picture = laidOut(
      FTYP,
      pictureMoov([mediaAt, mediaAt + 100 + 8 + big - 10]),
      { type: 'mdat', size: 108 },
      { type: 'mdat', size: big + 8 },
    );
    const soundMoov = moov(1000, 0, [
      { id: 1, handler: 'soun', mediaTimescale: 1000, offsets: [] },
    ]);
    const sound = laidOut(FTYP, soundMoov, { type: 'mdat', size: 8 });

    const plan = joinPlan(picture, sound);
    const header = bytesOf(plan[2]);
    const joined = bytesOf(plan[1]);
    const [pictureTrak] = children(joined, 'trak');

    expect(header.byteLength).toBe(16);
    expect(childrenOf(child(pictureTrak!, 'mdia', 'minf', 'stbl')).map(typeOf)).toEqual([
      'stsz',
      'co64',
    ]);
    expect(offsetsOf(pictureTrak!)[1]).toBeGreaterThan(0xffffffff);
  });

  it('refuses a chunk outside the media data as unreadable', () => {
    const pictureMoov = moov(1000, 0, [
      { id: 1, handler: 'vide', mediaTimescale: 1000, offsets: [3] },
    ]);
    const picture = laidOut(FTYP, pictureMoov, { type: 'mdat', size: 50 });
    const sound = laidOut(FTYP, moov(1000, 0, [{ id: 1, handler: 'soun', mediaTimescale: 1000 }]), {
      type: 'mdat',
      size: 8,
    });

    expect(refusalOf(() => joinPlan(picture, sound))).toBe(Mp4Refusal.Unreadable);
  });
});

describe('joinPlan, for two fragmented movies', () => {
  const fragmentedMoov = (
    handler: string,
    mediaTimescale: number,
    defaultDuration = 0,
    length?: number,
  ) =>
    moov(
      1000,
      0,
      [{ id: 1, handler, mediaTimescale }],
      boxOf('mvex', ...(length === undefined ? [] : [mehd(length)]), trex(1, defaultDuration)),
    );

  it('puts the fragments of both in the order they play, numbered again, the picture first at a tie', () => {
    // The picture: a fragment a second, at 0, 1 and 2 s (timescale 10). The sound: at 0 and 1.5 s.
    const picture = laidOut(
      FTYP,
      fragmentedMoov('vide', 10),
      { type: 'sidx', size: 44 },
      moof(1, { trackId: 1, decodeTime: 0 }),
      { type: 'mdat', size: 100 },
      moof(2, { trackId: 1, decodeTime: 10 }),
      { type: 'mdat', size: 100 },
      moof(3, { trackId: 1, decodeTime: 20 }),
      { type: 'mdat', size: 100 },
      { type: 'mfra', size: 40 },
    );
    const sound = laidOut(
      FTYP,
      fragmentedMoov('soun', 1000),
      moof(1, { trackId: 1, decodeTime: 0 }),
      { type: 'mdat', size: 50 },
      moof(2, { trackId: 1, decodeTime: 1500 }),
      { type: 'mdat', size: 50 },
    );

    const plan = joinPlan(picture, sound);
    const fragments = plan.slice(2);
    const order = fragments
      .filter((written) => written.kind === 'copy')
      .map((written) => (written as { from: string }).from);
    const headers = fragments
      .filter((written) => written.kind === 'bytes')
      .map((written) => bytesOf(written));

    expect(order).toEqual(['picture', 'sound', 'picture', 'sound', 'picture']);
    expect(headers.map((header) => field(child(header, 'mfhd'), 4))).toEqual([1, 2, 3, 4, 5]);
    expect(headers.map((header) => field(child(header, 'traf', 'tfhd'), 4))).toEqual([
      1, 2, 1, 2, 1,
    ]);
    // The sidx and the mfra name places in the old files: neither is written.
    expect(
      plan.map((written) => (written.kind === 'bytes' ? typeOf(written.bytes) : 'data')),
    ).not.toContain('sidx');
  });

  it("copies what follows a fragment's header up to the end of its data, as it stands", () => {
    const header = moof(1, { trackId: 1, decodeTime: 0 });
    const picture = laidOut(
      FTYP,
      fragmentedMoov('vide', 10),
      header,
      { type: 'free', size: 12 },
      { type: 'mdat', size: 100 },
    );
    const sound = laidOut(
      FTYP,
      fragmentedMoov('soun', 10),
      moof(1, { trackId: 1, decodeTime: 0 }),
      { type: 'mdat', size: 9 },
    );

    const plan = joinPlan(picture, sound);
    const moofAt = startOf(picture, 2);

    expect(plan[3]).toEqual({
      kind: 'copy',
      from: 'picture',
      start: moofAt + header.byteLength,
      end: moofAt + header.byteLength + 12 + 100,
    });
  });

  it('moves a fragment that says where its data is from the start of the file', () => {
    // Its data said: the first byte of its moof, which comes after the ftyp and the movie.
    const moofAt = FTYP.byteLength + fragmentedMoov('vide', 10).byteLength;
    const picture = laidOut(
      FTYP,
      fragmentedMoov('vide', 10),
      moof(1, { trackId: 1, decodeTime: 0, baseDataOffset: moofAt }),
      { type: 'mdat', size: 100 },
    );
    const sound = laidOut(
      FTYP,
      fragmentedMoov('soun', 10),
      moof(1, { trackId: 1, decodeTime: 5 }),
      { type: 'mdat', size: 9 },
    );

    const plan = joinPlan(picture, sound);
    const position = bytesOf(plan[0]).byteLength + bytesOf(plan[1]).byteLength;
    const tfhd = child(bytesOf(plan[2]), 'traf', 'tfhd');

    expect(startOf(picture, 2)).toBe(moofAt);
    expect(Number(view(tfhd).getBigUint64(16))).toBe(position);
  });

  it('starts a fragment with no time of its own where the one before it ended', () => {
    // The picture's samples last 2 each, by default, then 3 and 4: fragments at 0, 6 and 13.
    const picture = laidOut(
      FTYP,
      fragmentedMoov('vide', 1, 2),
      moof(1, { trackId: 1, count: 3 }),
      { type: 'mdat', size: 10 },
      moof(2, { trackId: 1, durations: [3, 4] }),
      { type: 'mdat', size: 10 },
      moof(3, { trackId: 1, count: 1 }),
      { type: 'mdat', size: 10 },
    );
    const sound = laidOut(
      FTYP,
      fragmentedMoov('soun', 1),
      moof(1, { trackId: 1, decodeTime: 5 }),
      { type: 'mdat', size: 10 },
      moof(2, { trackId: 1, decodeTime: 7, count: 1, defaultDuration: 1 }),
      { type: 'mdat', size: 10 },
    );

    const order = joinPlan(picture, sound)
      .filter((written) => written.kind === 'copy')
      .map((written) => (written as { from: string }).from);

    expect(order).toEqual(['picture', 'sound', 'picture', 'sound', 'picture']);
  });

  it('extends the joined movie with both tracks, its length the longer in its timescale', () => {
    const picture = laidOut(
      FTYP,
      fragmentedMoov('vide', 10, 0, 3000),
      moof(1, { trackId: 1, decodeTime: 0 }),
      { type: 'mdat', size: 9 },
    );
    const sound = laidOut(
      FTYP,
      moov(
        500,
        0,
        [{ id: 1, handler: 'soun', mediaTimescale: 10 }],
        boxOf('mvex', mehd(2000), trex(1, 0)),
      ),
      moof(1, { trackId: 1, decodeTime: 0 }),
      { type: 'mdat', size: 9 },
    );

    const mvex = child(bytesOf(joinPlan(picture, sound)[1]), 'mvex');

    expect(children(mvex, 'trex').map((entry) => field(entry, 4))).toEqual([1, 2]);
    expect(Number(view(child(mvex, 'mehd')).getBigUint64(12))).toBe(4000);
  });

  it('refuses a fragment with no data, or of another track, as unreadable', () => {
    const sound = laidOut(
      FTYP,
      fragmentedMoov('soun', 10),
      moof(1, { trackId: 1, decodeTime: 0 }),
      { type: 'mdat', size: 9 },
    );
    const noData = laidOut(
      FTYP,
      fragmentedMoov('vide', 10),
      moof(1, { trackId: 1, decodeTime: 0 }),
    );
    const otherTrack = laidOut(
      FTYP,
      fragmentedMoov('vide', 10),
      moof(1, { trackId: 4, decodeTime: 0 }),
      { type: 'mdat', size: 9 },
    );

    expect(refusalOf(() => joinPlan(noData, sound))).toBe(Mp4Refusal.Unreadable);
    expect(refusalOf(() => joinPlan(otherTrack, sound))).toBe(Mp4Refusal.Unreadable);
  });
});

describe('joinPlan refuses', () => {
  const plain = (handler: string) =>
    laidOut(FTYP, moov(1000, 0, [{ id: 1, handler, mediaTimescale: 1000 }]), {
      type: 'mdat',
      size: 8,
    });
  const fragmented = (handler: string) =>
    laidOut(
      FTYP,
      moov(1000, 0, [{ id: 1, handler, mediaTimescale: 1000 }], boxOf('mvex', trex(1, 0))),
      moof(1, { trackId: 1, decodeTime: 0 }),
      {
        type: 'mdat',
        size: 8,
      },
    );

  it('a picture that is not a picture, or a sound that is not sound, as files it does not join', () => {
    expect(refusalOf(() => joinPlan(plain('soun'), plain('soun')))).toBe(Mp4Refusal.Unsupported);
    expect(refusalOf(() => joinPlan(plain('vide'), plain('vide')))).toBe(Mp4Refusal.Unsupported);
  });

  it('a fragmented file beside one that is not', () => {
    expect(refusalOf(() => joinPlan(fragmented('vide'), plain('soun')))).toBe(
      Mp4Refusal.Unsupported,
    );
  });

  it('a file with no movie, or with two, as unreadable', () => {
    const none = laidOut(FTYP, { type: 'mdat', size: 8 });
    const movie = moov(1000, 0, [{ id: 1, handler: 'vide', mediaTimescale: 1000 }]);
    const twice = laidOut(FTYP, movie, movie, { type: 'mdat', size: 8 });

    expect(refusalOf(() => joinPlan(none, plain('soun')))).toBe(Mp4Refusal.Unreadable);
    expect(refusalOf(() => joinPlan(twice, plain('soun')))).toBe(Mp4Refusal.Unreadable);
  });

  it('a fragmented file that keeps samples in its movie, or media data outside its fragments, as one it does not join', () => {
    // ffmpeg without `empty_moov`: the first samples in the movie's tables and an mdat before any fragment.
    const withSamples = laidOut(
      FTYP,
      moov(
        1000,
        0,
        [{ id: 1, handler: 'vide', mediaTimescale: 1000, samples: 10 }],
        boxOf('mvex', trex(1, 0)),
      ),
      moof(1, { trackId: 1, decodeTime: 0 }),
      { type: 'mdat', size: 8 },
    );
    const looseData = laidOut(
      FTYP,
      moov(1000, 0, [{ id: 1, handler: 'vide', mediaTimescale: 1000 }], boxOf('mvex', trex(1, 0))),
      { type: 'mdat', size: 50 },
      moof(1, { trackId: 1, decodeTime: 0 }),
      { type: 'mdat', size: 8 },
    );

    expect(refusalOf(() => joinPlan(withSamples, fragmented('soun')))).toBe(Mp4Refusal.Unsupported);
    expect(refusalOf(() => joinPlan(fragmented('vide'), withSamples))).toBe(Mp4Refusal.Unsupported);
    expect(refusalOf(() => joinPlan(looseData, fragmented('soun')))).toBe(Mp4Refusal.Unsupported);
  });

  it('a box too short for the fields it holds as unreadable, never as an error of another kind', () => {
    const short = (type: string) => boxOf(type, versionAndFlags(0, 0));
    const withMvhd = laidOut(
      FTYP,
      boxOf('moov', short('mvhd'), trak({ id: 1, handler: 'vide', mediaTimescale: 1 })),
      {
        type: 'mdat',
        size: 8,
      },
    );
    const withTkhd = laidOut(
      FTYP,
      boxOf(
        'moov',
        mvhd(1000, 0),
        boxOf('trak', short('tkhd'), boxOf('mdia', mdhd(1), hdlr('vide'))),
      ),
      { type: 'mdat', size: 8 },
    );
    const withTfhd = laidOut(
      FTYP,
      moov(1000, 0, [{ id: 1, handler: 'vide', mediaTimescale: 1000 }], boxOf('mvex', trex(1, 0))),
      boxOf('moof', boxOf('mfhd', versionAndFlags(0, 0), u32(1)), boxOf('traf', short('tfhd'))),
      { type: 'mdat', size: 8 },
    );

    expect(refusalOf(() => joinPlan(withMvhd, plain('soun')))).toBe(Mp4Refusal.Unreadable);
    expect(refusalOf(() => joinPlan(withTkhd, plain('soun')))).toBe(Mp4Refusal.Unreadable);
    expect(refusalOf(() => joinPlan(withTfhd, fragmented('soun')))).toBe(Mp4Refusal.Unreadable);
  });
});
