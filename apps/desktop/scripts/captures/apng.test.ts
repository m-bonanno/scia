import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../icons/png.ts';
import { decodePng, encodeApng, type Picture } from './apng.ts';

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
}

function chunksOf(png: Buffer): Chunk[] {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const chunks: Chunk[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, data });
    at += 12 + length;
  }
  return chunks;
}

const picture = (width: number, height: number, paint: (x: number, y: number) => number[]) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.set(paint(x, y), (y * width + x) * 4);
  return { width, height, rgba };
};

// A PNG whose rows carry the filter each names: what Chromium writes chooses one per row.
function filteredPng(rgb: Picture, filters: readonly number[]): Buffer {
  const { width, height } = rgb;
  const bpp = 3;
  const stride = width * bpp;
  const raw = Buffer.alloc(stride * height);
  for (let i = 0; i < width * height; i++) raw.set(rgb.rgba.subarray(i * 4, i * 4 + 3), i * bpp);
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length] ?? 0;
    out[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const value = raw[y * stride + i] ?? 0;
      const left = i >= bpp ? (raw[y * stride + i - bpp] ?? 0) : 0;
      const up = y > 0 ? (raw[(y - 1) * stride + i] ?? 0) : 0;
      const upLeft = y > 0 && i >= bpp ? (raw[(y - 1) * stride + i - bpp] ?? 0) : 0;
      const paeth = () => {
        const p = left + up - upLeft;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return a <= b && a <= c ? left : b <= c ? up : upLeft;
      };
      const predicted = [0, left, up, (left + up) >> 1, paeth()][filter] ?? 0;
      out[y * (stride + 1) + 1 + i] = (value - predicted) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const frame = Buffer.alloc(8 + data.length + 4);
    frame.writeUInt32BE(data.length, 0);
    typed.copy(frame, 4);
    frame.writeUInt32BE(crc32(typed), 8 + data.length);
    return frame;
  };
  const idat = deflateSync(out);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    // The image data split in two, as a writer may.
    chunk('IDAT', idat.subarray(0, 5)),
    chunk('IDAT', idat.subarray(5)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// What a viewer shows after each frame: each region drawn over the last, replacing it.
function played(apng: Buffer): Picture[] {
  const chunks = chunksOf(apng);
  const header = chunks.find((chunk) => chunk.type === 'IHDR')?.data ?? Buffer.alloc(0);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  expect([...header.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  const canvas = new Uint8Array(width * height * 4);
  const shown: Picture[] = [];
  let region: { w: number; h: number; x: number; y: number } | undefined;
  const draw = (zlib: Buffer) => {
    if (region === undefined) throw new Error('image data before its frame control');
    const { w, h, x, y } = region;
    const rows = decodePng(pngOf(w, h, zlib)).rgba;
    for (let row = 0; row < h; row++)
      canvas.set(rows.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * width + x) * 4);
    shown.push({ width, height, rgba: canvas.slice() });
  };
  let idat: Buffer[] = [];
  for (const { type, data } of chunks) {
    if (type === 'fcTL') {
      if (idat.length > 0) draw(Buffer.concat(idat));
      idat = [];
      region = {
        w: data.readUInt32BE(4),
        h: data.readUInt32BE(8),
        x: data.readUInt32BE(12),
        y: data.readUInt32BE(16),
      };
      expect([data[24], data[25]]).toEqual([0, 0]);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'fdAT') draw(data.subarray(4));
  }
  if (idat.length > 0) draw(Buffer.concat(idat));
  return shown;
}

function pngOf(width: number, height: number, zlib: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const frame = Buffer.alloc(8 + data.length + 4);
    frame.writeUInt32BE(data.length, 0);
    typed.copy(frame, 4);
    frame.writeUInt32BE(crc32(typed), 8 + data.length);
    return frame;
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const gradient = (shift: number) =>
  picture(7, 5, (x, y) => [(x * 37 + shift) & 0xff, (y * 51) & 0xff, (x * y * 13) & 0xff, 255]);

describe('decodePng', () => {
  it('reads the pixels of an RGBA image', () => {
    const square = picture(3, 3, (x, y) => [x * 80, y * 80, 7, x === y ? 255 : 128]);
    expect(decodePng(encodePng({ size: 3, rgba: square.rgba }))).toEqual(square);
  });

  it('reads an RGB image whose rows carry each of the five filters, its data in two chunks', () => {
    expect(decodePng(filteredPng(gradient(0), [0, 1, 2, 3, 4]))).toEqual(gradient(0));
  });

  it('refuses what it cannot read rather than read it wrong', () => {
    const interlaced = encodePng({ size: 1, rgba: new Uint8Array([1, 2, 3, 4]) });
    interlaced[8 + 8 + 12] = 1;
    expect(() => decodePng(interlaced)).toThrow(/interlac/);
    expect(() => decodePng(Buffer.from('not a png'))).toThrow(/PNG/);
  });
});

describe('encodeApng', () => {
  const still = gradient(0);
  const moved = picture(7, 5, (x, y) => {
    const base = [...still.rgba.subarray((y * 7 + x) * 4, (y * 7 + x) * 4 + 4)];
    return x >= 2 && x <= 4 && y >= 1 && y <= 2 ? [255, 0, 0, 255] : base;
  });

  it('plays every picture in turn, forever, each for its time', () => {
    const apng = encodeApng([
      { picture: still, ms: 1200 },
      { picture: moved, ms: 80 },
      { picture: still, ms: 2500 },
    ]);
    expect(played(apng)).toEqual([still, moved, still]);
    const chunks = chunksOf(apng);
    const control = chunks.find((chunk) => chunk.type === 'acTL')?.data;
    expect([control?.readUInt32BE(0), control?.readUInt32BE(4)]).toEqual([3, 0]);
    const delays = chunks
      .filter((chunk) => chunk.type === 'fcTL')
      .map(({ data }) => data.readUInt16BE(20) / data.readUInt16BE(22));
    expect(delays).toEqual([1.2, 0.08, 2.5]);
  });

  it('writes of a frame only the region that changed since the one before', () => {
    const frames = chunksOf(
      encodeApng([
        { picture: still, ms: 100 },
        { picture: moved, ms: 100 },
      ]),
    )
      .filter((chunk) => chunk.type === 'fcTL')
      .map(({ data }) => [4, 8, 12, 16].map((at) => data.readUInt32BE(at)));
    expect(frames).toEqual([
      [7, 5, 0, 0],
      [3, 2, 2, 1],
    ]);
  });

  it('numbers frame controls and frame data as one sequence from zero', () => {
    const numbers = chunksOf(
      encodeApng([
        { picture: still, ms: 100 },
        { picture: moved, ms: 100 },
        { picture: still, ms: 100 },
      ]),
    )
      .filter((chunk) => chunk.type === 'fcTL' || chunk.type === 'fdAT')
      .map(({ data }) => data.readUInt32BE(0));
    expect(numbers).toEqual([0, 1, 2, 3, 4]);
  });

  it('adds a picture that changed nothing to the time of the one before', () => {
    const apng = encodeApng([
      { picture: still, ms: 300 },
      { picture: still, ms: 200 },
      { picture: moved, ms: 100 },
    ]);
    expect(played(apng)).toEqual([still, moved]);
    expect(
      chunksOf(apng)
        .filter((chunk) => chunk.type === 'fcTL')
        .map(({ data }) => data.readUInt16BE(20)),
    ).toEqual([500, 100]);
  });

  it('refuses pictures of different sizes, and no picture at all', () => {
    expect(() =>
      encodeApng([
        { picture: still, ms: 100 },
        { picture: picture(1, 1, () => [0, 0, 0, 255]), ms: 100 },
      ]),
    ).toThrow(/7×5/);
    expect(() => encodeApng([])).toThrow(/no picture/);
  });

  it('keeps each frame smaller than the whole picture when little moved', () => {
    const big = (shift: number) =>
      picture(200, 100, (x, y) => (x < 10 && y < 10 ? [shift, 0, 0, 255] : [20, 20, 20, 255]));
    const apng = encodeApng([
      { picture: big(0), ms: 100 },
      { picture: big(200), ms: 100 },
    ]);
    const second = chunksOf(apng).find((chunk) => chunk.type === 'fdAT')?.data ?? Buffer.alloc(4);
    expect(inflateSync(second.subarray(4)).length).toBe((10 * 4 + 1) * 10);
  });
});
