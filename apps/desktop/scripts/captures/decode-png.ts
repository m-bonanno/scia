import { inflateSync } from 'node:zlib';
import { BIT_DEPTH, COLOUR_TYPE_RGB, COLOUR_TYPE_RGBA, SIGNATURE } from '../icons/png.ts';

// A picture of any size, its pixels row by row as red, green, blue and alpha.
export interface Picture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

// What Chromium's captures are: 8 bits a channel, RGB or RGBA, not interlaced.
const CHANNELS_OF_COLOUR_TYPE = new Map([
  [COLOUR_TYPE_RGB, 3],
  [COLOUR_TYPE_RGBA, 4],
]);
const NOT_INTERLACED = 0;

export function decodePng(png: Buffer): Picture {
  if (png.length < SIGNATURE.length || !png.subarray(0, SIGNATURE.length).equals(SIGNATURE))
    throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  for (let at = SIGNATURE.length; at + 8 <= png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = body.subarray(8);
      if (interlace !== NOT_INTERLACED) throw new Error('an interlaced PNG is not read');
      channels = depth === BIT_DEPTH ? (CHANNELS_OF_COLOUR_TYPE.get(colour ?? -1) ?? 0) : 0;
      if (channels === 0)
        throw new Error(
          `a PNG of depth ${String(depth)} and colour type ${String(colour)} is not read`,
        );
    } else if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  if (channels === 0) throw new Error('a PNG with no header is not read');
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(data));
  if (inflated.length !== (stride + 1) * height)
    throw new Error(
      `image data of ${String(inflated.length)} bytes where ${String(width)}×${String(height)} needs ${String((stride + 1) * height)}`,
    );
  const rows = unfilter(inflated, stride, height, channels);
  if (channels === 4) return { width, height, rgba: rows };
  const rgba = new Uint8Array(width * height * 4).fill(0xff);
  for (let pixel = 0; pixel < width * height; pixel++)
    rgba.set(rows.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
  return { width, height, rgba };
}

// The five predictors of PNG's filters, by their number.
function predicted(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toUpLeft = Math.abs(estimate - upLeft);
      if (toLeft <= toUp && toLeft <= toUpLeft) return left;
      return toUp <= toUpLeft ? up : upLeft;
    }
    default:
      throw new Error(`a row of filter ${String(filter)} is not read`);
  }
}

function unfilter(data: Uint8Array, stride: number, height: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const from = y * (stride + 1);
    const filter = data[from] ?? 0;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? (out[row + i - bpp] ?? 0) : 0;
      const up = y > 0 ? (out[row - stride + i] ?? 0) : 0;
      const upLeft = y > 0 && i >= bpp ? (out[row - stride + i - bpp] ?? 0) : 0;
      out[row + i] = ((data[from + 1 + i] ?? 0) + predicted(filter, left, up, upLeft)) & 0xff;
    }
  }
  return out;
}
