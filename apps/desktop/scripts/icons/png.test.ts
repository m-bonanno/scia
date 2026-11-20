import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from './png.ts';

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
  readonly crc: number;
  readonly checked: number;
}

function chunksOf(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const typed = png.subarray(at + 4, at + 8 + length);
    chunks.push({
      type: typed.subarray(0, 4).toString('latin1'),
      data: typed.subarray(4),
      crc: png.readUInt32BE(at + 8 + length),
      checked: crc32(typed),
    });
    at += 12 + length;
  }
  return chunks;
}

// Two by two: opaque red, half-transparent green / transparent, opaque white.
const PIXELS = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 0, 255, 255, 255, 255]);

describe('encodePng', () => {
  it('starts with the PNG signature', () => {
    const png = encodePng({ size: 2, rgba: PIXELS });

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('says its size and that it is 8-bit RGBA, not interlaced', () => {
    const header = chunksOf(encodePng({ size: 2, rgba: PIXELS }))[0];

    expect(header?.type).toBe('IHDR');
    expect(header?.data.readUInt32BE(0)).toBe(2);
    expect(header?.data.readUInt32BE(4)).toBe(2);
    expect([...(header?.data.subarray(8) ?? [])]).toEqual([8, 6, 0, 0, 0]);
  });

  it('carries the pixels as given, each row behind a filter of none', () => {
    const data = chunksOf(encodePng({ size: 2, rgba: PIXELS })).filter((c) => c.type === 'IDAT');

    const rows = inflateSync(Buffer.concat(data.map((c) => c.data)));

    expect([...rows]).toEqual([0, ...PIXELS.subarray(0, 8), 0, ...PIXELS.subarray(8)]);
  });

  it('seals every chunk with its CRC and ends with IEND', () => {
    const chunks = chunksOf(encodePng({ size: 2, rgba: PIXELS }));

    expect(chunks.map((c) => c.crc)).toEqual(chunks.map((c) => c.checked));
    expect(chunks.at(-1)?.type).toBe('IEND');
  });

  it('refuses pixels that do not fill the square', () => {
    expect(() => encodePng({ size: 3, rgba: PIXELS })).toThrow(/3×3/);
  });
});
