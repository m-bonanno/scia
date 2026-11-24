import { describe, expect, it } from 'vitest';
import type { Picture } from './decode-png.ts';
import { encodeGif, type Frame } from './gif.ts';

interface Played {
  readonly loops: number | undefined;
  readonly frames: {
    readonly picture: Picture;
    readonly centiseconds: number;
    readonly region: readonly [number, number, number, number];
    readonly transparent: boolean;
  }[];
}

// The spec's own LZW decoder, as GIF89a's appendix F describes it: the encoder is read against a
// reader it did not write.
function lzw(data: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let table: number[][] = [];
  let size = 0;
  const reset = () => {
    table = Array.from({ length: clear + 2 }, (_, code) => [code]);
    size = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let previous: number[] | undefined;
  let bits = 0;
  let held = 0;
  let at = 0;
  for (;;) {
    while (held < size) {
      if (at >= data.length) throw new Error('the codes ran out before the end code');
      bits |= (data[at++] ?? 0) << held;
      held += 8;
    }
    const code = bits & ((1 << size) - 1);
    bits >>>= size;
    held -= size;
    if (code === clear) {
      reset();
      previous = undefined;
      continue;
    }
    if (code === end) return out;
    const known = table[code];
    const entry =
      known ??
      (previous !== undefined && code === table.length
        ? [...previous, previous[0] ?? 0]
        : undefined);
    if (entry === undefined) throw new Error(`code ${String(code)} is not in the table`);
    out.push(...entry);
    if (previous !== undefined && table.length < 4096) {
      table.push([...previous, entry[0] ?? 0]);
      if (table.length === 1 << size && size < 12) size++;
    }
    previous = entry;
  }
}

// What a viewer shows after each frame: each frame drawn over the last where it is not transparent.
function played(gif: Buffer): Played {
  expect(gif.toString('latin1', 0, 6)).toBe('GIF89a');
  const width = gif.readUInt16LE(6);
  const height = gif.readUInt16LE(8);
  expect(gif[10]! & 0x80).toBe(0);
  const canvas = new Uint8Array(width * height * 4);
  const frames: Played['frames'][number][] = [];
  let loops: number | undefined;
  let control = { centiseconds: 0, transparent: -1 };
  let at = 13;
  for (;;) {
    const introducer = gif[at];
    if (introducer === 0x3b) {
      expect(at).toBe(gif.length - 1);
      return { loops, frames };
    }
    if (introducer === 0x21) {
      const label = gif[at + 1];
      at += 2;
      const blocks: Buffer[] = [];
      for (let length = gif[at] ?? 0; length > 0; length = gif[at] ?? 0) {
        blocks.push(gif.subarray(at + 1, at + 1 + length));
        at += 1 + length;
      }
      at += 1;
      const [first, second] = blocks;
      if (label === 0xf9 && first !== undefined) {
        expect((first[0] ?? 0) >> 2).toBe(1);
        control = {
          centiseconds: first.readUInt16LE(1),
          transparent: ((first[0] ?? 0) & 1) === 1 ? (first[3] ?? -1) : -1,
        };
      }
      if (label === 0xff && first?.toString('latin1') === 'NETSCAPE2.0' && second !== undefined)
        loops = second.readUInt16LE(1);
      continue;
    }
    expect(introducer).toBe(0x2c);
    const region = [1, 3, 5, 7].map((offset) => gif.readUInt16LE(at + offset)) as [
      number,
      number,
      number,
      number,
    ];
    const packed = gif[at + 9] ?? 0;
    expect(packed & 0x80).toBe(0x80);
    expect(packed & 0x40).toBe(0);
    const entries = 2 << (packed & 0x07);
    const palette = gif.subarray(at + 10, at + 10 + entries * 3);
    at += 10 + entries * 3;
    const minCodeSize = gif[at] ?? 0;
    // GIF89a's appendix F: a code size of 2 at least, also for a palette of two colours.
    expect(minCodeSize).toBeGreaterThanOrEqual(2);
    at += 1;
    const data: Buffer[] = [];
    for (let length = gif[at] ?? 0; length > 0; length = gif[at] ?? 0) {
      expect(length).toBeLessThanOrEqual(255);
      data.push(gif.subarray(at + 1, at + 1 + length));
      at += 1 + length;
    }
    at += 1;
    const [x, y, w, h] = region;
    const indices = lzw(Buffer.concat(data), minCodeSize);
    expect(indices.length).toBe(w * h);
    indices.forEach((index, i) => {
      expect(index).toBeLessThan(entries);
      if (index === control.transparent) return;
      const pixel = ((y + Math.floor(i / w)) * width + x + (i % w)) * 4;
      canvas.set([...palette.subarray(index * 3, index * 3 + 3), 255], pixel);
    });
    frames.push({
      picture: { width, height, rgba: canvas.slice() },
      centiseconds: control.centiseconds,
      region,
      transparent: control.transparent >= 0,
    });
    control = { centiseconds: 0, transparent: -1 };
  }
}

const picture = (width: number, height: number, paint: (x: number, y: number) => number[]) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.set([...paint(x, y), 255], (y * width + x) * 4);
  return { width, height, rgba };
};

const still = picture(7, 5, (x, y) => [(x * 37) & 0xff, (y * 51) & 0xff, (x * y * 13) & 0xff]);
// The still picture with a red patch of three by two, and one with two pixels changed far apart.
const moved = picture(7, 5, (x, y) =>
  x >= 2 && x <= 4 && y >= 1 && y <= 2
    ? [255, 0, 0]
    : [(x * 37) & 0xff, (y * 51) & 0xff, (x * y * 13) & 0xff],
);
const corners = picture(7, 5, (x, y) =>
  (x === 1 && y === 1) || (x === 5 && y === 3)
    ? [0, 0, 255]
    : [(x * 37) & 0xff, (y * 51) & 0xff, (x * y * 13) & 0xff],
);

describe('encodeGif', () => {
  it('plays every picture in turn, forever, each for its time', () => {
    const gif = played(
      encodeGif([
        { picture: still, ms: 1200 },
        { picture: moved, ms: 80 },
        { picture: still, ms: 2500 },
      ]),
    );
    expect(gif.loops).toBe(0);
    expect(gif.frames.map((frame) => frame.picture)).toEqual([still, moved, still]);
    expect(gif.frames.map((frame) => frame.centiseconds)).toEqual([120, 8, 250]);
  });

  it('writes of a frame only the region that changed, the pixels in it that did not transparent', () => {
    const gif = played(
      encodeGif([
        { picture: still, ms: 100 },
        { picture: moved, ms: 100 },
        { picture: corners, ms: 100 },
      ]),
    );
    expect(gif.frames.map((frame) => frame.region)).toEqual([
      [0, 0, 7, 5],
      [2, 1, 3, 2],
      [1, 1, 5, 3],
    ]);
    expect(gif.frames.map((frame) => frame.transparent)).toEqual([false, true, true]);
    expect(gif.frames.map((frame) => frame.picture)).toEqual([still, moved, corners]);
  });

  it('adds a picture that changed nothing to the time of the one before', () => {
    const gif = played(
      encodeGif([
        { picture: still, ms: 300 },
        { picture: still, ms: 200 },
        { picture: moved, ms: 100 },
      ]),
    );
    expect(gif.frames.map((frame) => frame.picture)).toEqual([still, moved]);
    expect(gif.frames.map((frame) => frame.centiseconds)).toEqual([50, 10]);
  });

  // A GIF says a frame's time in hundredths of a second: each is rounded where the loop has got to,
  // so that the loop lasts its time and no frame is more than a hundredth off.
  it('rounds the frames to hundredths without the loop drifting from its time', () => {
    const frames: Frame[] = [still, moved, still, moved].map((each) => ({
      picture: each,
      ms: 105,
    }));
    expect(played(encodeGif(frames)).frames.map((frame) => frame.centiseconds)).toEqual([
      11, 10, 11, 10,
    ]);
  });

  // Past 4096 codes, LZW's table is full: the encoder starts it again with a clear code.
  it('writes a picture whose codes fill the table, and reads back as it was', () => {
    let seed = 7;
    const noise = picture(160, 120, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const grey = seed % 250;
      return [grey, grey, grey];
    });
    expect(played(encodeGif([{ picture: noise, ms: 100 }])).frames[0]?.picture).toEqual(noise);
  });

  it('writes a picture of one colour and one of two', () => {
    const black = picture(3, 2, () => [0, 0, 0]);
    const dot = picture(3, 2, (x, y) => (x === 1 && y === 1 ? [255, 255, 255] : [0, 0, 0]));
    const gif = played(
      encodeGif([
        { picture: black, ms: 100 },
        { picture: dot, ms: 100 },
      ]),
    );
    expect(gif.frames.map((frame) => frame.picture)).toEqual([black, dot]);
  });

  it('refuses pictures of different sizes, and no picture at all', () => {
    expect(() =>
      encodeGif([
        { picture: still, ms: 100 },
        { picture: picture(1, 1, () => [0, 0, 0]), ms: 100 },
      ]),
    ).toThrow('a picture of 1×1 among pictures of 7×5');
    expect(() =>
      encodeGif([
        { picture: still, ms: 100 },
        { picture: picture(7, 4, () => [0, 0, 0]), ms: 100 },
      ]),
    ).toThrow('a picture of 7×4 among pictures of 7×5');
    expect(() => encodeGif([])).toThrow('no picture to play');
  });

  it('refuses what a GIF cannot hold rather than change it', () => {
    const many = picture(17, 17, (x, y) => [x * 15, y * 15, 0]);
    expect(() => encodeGif([{ picture: many, ms: 100 }])).toThrow(
      'a frame of 289 colours, where a GIF holds 256',
    );
    const seeThrough = { ...still, rgba: still.rgba.slice() };
    seeThrough.rgba[3] = 128;
    expect(() => encodeGif([{ picture: seeThrough, ms: 100 }])).toThrow(
      'a pixel that is not opaque',
    );
    expect(() => encodeGif([{ picture: still, ms: 655_360 }])).toThrow(
      'a frame of 655360 ms, where a GIF holds 655350',
    );
  });
});
