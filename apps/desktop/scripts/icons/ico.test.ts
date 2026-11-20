import { describe, expect, it } from 'vitest';
import { encodeIco, readIcoDirectory } from './ico.ts';
import type { Raster } from './png.ts';

function square(size: number, pixel: (x: number, y: number) => readonly number[]): Raster {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) rgba.set(pixel(x, y), (y * size + x) * 4);
  return { size, rgba };
}

const opaque = (size: number): Raster => square(size, () => [10, 20, 30, 255]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

describe('encodeIco', () => {
  it('lists every image in its directory, smallest first', () => {
    const ico = encodeIco([opaque(256), opaque(16), opaque(48)]);

    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(readIcoDirectory(ico).map((entry) => entry.size)).toEqual([16, 48, 256]);
  });

  // The directory has a byte for a side: 0 stands for 256.
  it('writes 256 as 0 in the directory', () => {
    const ico = encodeIco([opaque(256)]);

    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(0);
  });

  it('points every entry at bytes of its own, one after the other, to the end', () => {
    const ico = encodeIco([opaque(16), opaque(32), opaque(256)]);
    const entries = readIcoDirectory(ico);

    expect(entries[0]?.offset).toBe(6 + 16 * 3);
    for (let i = 1; i < entries.length; i++)
      expect(entries[i]?.offset).toBe((entries[i - 1]?.offset ?? 0) + (entries[i - 1]?.bytes ?? 0));
    expect((entries.at(-1)?.offset ?? 0) + (entries.at(-1)?.bytes ?? 0)).toBe(ico.length);
  });

  // The layout Windows itself ships: a PNG for 256, bitmaps below it, which every reader of
  // icons takes — NSIS's compiler and resource editors among them.
  it('stores 256 as a PNG and every smaller size as a 32-bit bitmap', () => {
    const ico = encodeIco([opaque(16), opaque(256)]);
    const [small, large] = readIcoDirectory(ico);

    expect([...ico.subarray(large?.offset, (large?.offset ?? 0) + 4)]).toEqual(PNG_SIGNATURE);
    expect(ico.readUInt32LE(small?.offset ?? 0)).toBe(40);
    expect(ico.readUInt16LE((small?.offset ?? 0) + 14)).toBe(32);
    expect(small?.bitsPerPixel).toBe(32);
  });

  // A bitmap of an icon counts the mask in its height.
  it('gives a bitmap twice its height, for the mask below its colours', () => {
    const ico = encodeIco([opaque(16)]);
    const [entry] = readIcoDirectory(ico);

    expect(ico.readInt32LE((entry?.offset ?? 0) + 4)).toBe(16);
    expect(ico.readInt32LE((entry?.offset ?? 0) + 8)).toBe(32);
  });

  it('writes the colours bottom row first, as blue, green, red, alpha', () => {
    const top = [200, 100, 50, 255];
    const ico = encodeIco([square(16, (_x, y) => (y === 0 ? top : [0, 0, 0, 255]))]);
    const [entry] = readIcoDirectory(ico);
    const pixels = (entry?.offset ?? 0) + 40;
    const lastRow = pixels + 15 * 16 * 4;

    expect([...ico.subarray(lastRow, lastRow + 4)]).toEqual([50, 100, 200, 255]);
    expect([...ico.subarray(pixels, pixels + 4)]).toEqual([0, 0, 0, 255]);
  });

  // Each row of the mask is a bit a pixel, padded to four bytes.
  it('marks in the mask the pixels that are fully transparent, and no other', () => {
    const ico = encodeIco([
      square(16, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 0] : [9, 9, 9, 1])),
    ]);
    const [entry] = readIcoDirectory(ico);
    const mask = (entry?.offset ?? 0) + 40 + 16 * 16 * 4;
    const topRow = mask + 15 * 4;

    expect(ico[topRow]).toBe(0b1000_0000);
    expect([...ico.subarray(mask, topRow)].every((byte) => byte === 0)).toBe(true);
    expect(entry?.bytes).toBe(40 + 16 * 16 * 4 + 16 * 4);
  });

  it('refuses a size an icon cannot hold, or the same size twice', () => {
    expect(() => encodeIco([opaque(16), opaque(16)])).toThrow(/16/);
    expect(() => encodeIco([square(512, () => [0, 0, 0, 0])])).toThrow(/512/);
    expect(() => encodeIco([])).toThrow();
  });
});
