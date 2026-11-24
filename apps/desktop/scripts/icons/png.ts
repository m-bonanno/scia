import { crc32, deflateSync } from 'node:zlib';

// A square image, its pixels row by row as red, green, blue and alpha, not premultiplied.
export interface Raster {
  readonly size: number;
  readonly rgba: Uint8Array;
}

export const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const BIT_DEPTH = 8;
export const COLOUR_TYPE_RGB = 2;
export const COLOUR_TYPE_RGBA = 6;

function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

export function assertSquare({ size, rgba }: Raster): void {
  if (!Number.isInteger(size) || size < 1 || rgba.length !== size * size * 4)
    throw new Error(
      `${String(rgba.length)} bytes are not the pixels of ${String(size)}×${String(size)}`,
    );
}

export function encodePng(raster: Raster): Buffer {
  assertSquare(raster);
  const { size, rgba } = raster;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([BIT_DEPTH, COLOUR_TYPE_RGBA, 0, 0, 0], 8);

  const stride = size * 4;
  // Each row begins with its filter byte: 0, none, which Buffer.alloc has already written.
  const rows = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    rows.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
