import { assertSquare, encodePng, type Raster } from './png.ts';

export interface IcoEntry {
  readonly size: number;
  readonly bitsPerPixel: number;
  readonly bytes: number;
  readonly offset: number;
}

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;
const BITMAP_HEADER_BYTES = 40;
const TYPE_ICON = 1;
const LARGEST = 256;

// Windows' own icons hold 256 as a PNG and the smaller sizes as bitmaps; every reader of icons
// takes that layout, the compiler of the NSIS installer among them.
function bitmapOf({ size, rgba }: Raster): Buffer {
  const maskStride = Math.ceil(size / 32) * 4;
  const bitmap = Buffer.alloc(BITMAP_HEADER_BYTES + size * size * 4 + maskStride * size);
  bitmap.writeUInt32LE(BITMAP_HEADER_BYTES, 0);
  bitmap.writeInt32LE(size, 4);
  // The height counts the colours and the mask below them.
  bitmap.writeInt32LE(size * 2, 8);
  bitmap.writeUInt16LE(1, 12);
  bitmap.writeUInt16LE(32, 14);

  const mask = BITMAP_HEADER_BYTES + size * size * 4;
  for (let row = 0; row < size; row++) {
    // A bitmap is written bottom row first.
    const y = size - 1 - row;
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = BITMAP_HEADER_BYTES + (row * size + x) * 4;
      bitmap.set(
        [rgba[from + 2] ?? 0, rgba[from + 1] ?? 0, rgba[from] ?? 0, rgba[from + 3] ?? 0],
        to,
      );
      if (rgba[from + 3] === 0) {
        const at = mask + row * maskStride + (x >> 3);
        bitmap[at] = (bitmap[at] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }
  return bitmap;
}

export function encodeIco(rasters: readonly Raster[]): Buffer {
  if (rasters.length === 0) throw new Error('An icon holds at least one image');
  const sorted = [...rasters].sort((a, b) => a.size - b.size);
  sorted.forEach((raster, i) => {
    assertSquare(raster);
    if (raster.size > LARGEST)
      throw new Error(`An icon holds no image larger than 256, not ${String(raster.size)}`);
    if (sorted[i - 1]?.size === raster.size)
      throw new Error(`An icon holds ${String(raster.size)} once`);
  });

  const images = sorted.map((raster) =>
    raster.size === LARGEST ? encodePng(raster) : bitmapOf(raster),
  );
  const header = Buffer.alloc(HEADER_BYTES + ENTRY_BYTES * images.length);
  header.writeUInt16LE(TYPE_ICON, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  sorted.forEach((raster, i) => {
    const at = HEADER_BYTES + ENTRY_BYTES * i;
    const bytes = images[i]?.length ?? 0;
    // A byte for a side: 0 stands for 256.
    header[at] = raster.size % LARGEST;
    header[at + 1] = raster.size % LARGEST;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes;
  });

  return Buffer.concat([header, ...images]);
}

export function readIcoDirectory(ico: Buffer): IcoEntry[] {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const at = HEADER_BYTES + ENTRY_BYTES * i;
    return {
      size: ico[at] === 0 ? LARGEST : (ico[at] ?? 0),
      bitsPerPixel: ico.readUInt16LE(at + 6),
      bytes: ico.readUInt32LE(at + 8),
      offset: ico.readUInt32LE(at + 12),
    };
  });
}
