import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../icons/png.ts';
import { decodePng, type Picture } from './decode-png.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Where the header's fields are, in a PNG whose first chunk is its header.
const AT_HEIGHT = 20;
const AT_DEPTH = 24;
const AT_COLOUR_TYPE = 25;
const AT_INTERLACE = 28;

// The spec's own chunk writer: the decoder is read against a PNG it did not write.
function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const frame = Buffer.alloc(8 + data.length + 4);
  frame.writeUInt32BE(data.length, 0);
  typed.copy(frame, 4);
  frame.writeUInt32BE(crc32(typed), 8 + data.length);
  return frame;
}

const picture = (width: number, height: number, paint: (x: number, y: number) => number[]) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.set(paint(x, y), (y * width + x) * 4);
  return { width, height, rgba };
};

const paeth = (left: number, up: number, upLeft: number) => {
  const p = left + up - upLeft;
  const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
  return a <= b && a <= c ? left : b <= c ? up : upLeft;
};

// An RGB PNG whose rows carry the filter each names, as Chromium's writer chooses one per row; a
// filter PNG does not have is written as None.
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
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter] ?? 0;
      out[y * (stride + 1) + 1 + i] = (value - predicted) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const idat = deflateSync(out);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    // The image data split in two, as a writer may.
    chunk('IDAT', idat.subarray(0, 5)),
    chunk('IDAT', idat.subarray(5)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A PNG of one opaque pixel with one byte of its header changed.
function withHeaderByte(at: number, value: number): Buffer {
  const png = encodePng({ size: 1, rgba: new Uint8Array([1, 2, 3, 255]) });
  png[at] = value;
  return png;
}

const gradient = picture(7, 5, (x, y) => [
  (x * 37) & 0xff,
  (y * 51) & 0xff,
  (x * y * 13) & 0xff,
  255,
]);

describe('decodePng', () => {
  it('reads the pixels of an RGBA image', () => {
    const square = picture(3, 3, (x, y) => [x * 80, y * 80, 7, x === y ? 255 : 128]);
    expect(decodePng(encodePng({ size: 3, rgba: square.rgba }))).toEqual(square);
  });

  it('reads an RGB image whose rows carry each of the five filters, its data in two chunks', () => {
    expect(decodePng(filteredPng(gradient, [0, 1, 2, 3, 4]))).toEqual(gradient);
  });

  // Paeth's predictor breaks a tie for the left first, then for the one above, and a tie between
  // two different values is the only place where the order shows: red ties the left with the one
  // above-left, green the one above with the one above-left.
  it("breaks Paeth's ties as PNG does: the left first, then the one above", () => {
    const ties = picture(2, 2, (x, y) => {
      if (y === 0) return x === 0 ? [10, 10, 0, 255] : [12, 6, 0, 255];
      return x === 0 ? [6, 12, 0, 255] : [200, 100, 50, 255];
    });
    expect(decodePng(filteredPng(ties, [0, 4]))).toEqual(ties);
  });

  it('refuses what is not a PNG', () => {
    expect(() => decodePng(Buffer.from('GIF89a and more'))).toThrow('not a PNG');
  });

  it('refuses a PNG with no header', () => {
    const headless = Buffer.concat([
      SIGNATURE,
      chunk('IDAT', deflateSync(Buffer.alloc(4))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(() => decodePng(headless)).toThrow('a PNG with no header is not read');
  });

  it('refuses a depth or a colour type other than 8-bit RGB or RGBA', () => {
    expect(() => decodePng(withHeaderByte(AT_DEPTH, 16))).toThrow(/depth 16 and colour type 6/);
    expect(() => decodePng(withHeaderByte(AT_COLOUR_TYPE, 3))).toThrow(/depth 8 and colour type 3/);
  });

  it('refuses an interlaced PNG', () => {
    expect(() => decodePng(withHeaderByte(AT_INTERLACE, 1))).toThrow(/interlaced/);
  });

  it('refuses a row of a filter PNG does not have', () => {
    expect(() => decodePng(filteredPng(gradient, [0, 5]))).toThrow('a row of filter 5 is not read');
  });

  it('refuses image data shorter than its header says', () => {
    expect(() => decodePng(withHeaderByte(AT_HEIGHT + 3, 2))).toThrow(
      'image data of 5 bytes where 1×2 needs 10',
    );
  });
});
