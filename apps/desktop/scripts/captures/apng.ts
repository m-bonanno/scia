import { deflateSync, inflateSync } from 'node:zlib';
import { BIT_DEPTH, chunk, COLOUR_TYPE_RGBA, SIGNATURE } from '../icons/png.ts';

// A picture of any size, its pixels row by row as red, green, blue and alpha.
export interface Picture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

// A picture, and how long it shows before the next one.
export interface Frame {
  readonly picture: Picture;
  readonly ms: number;
}

interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// What Chromium's captures are: 8 bits a channel, RGB or RGBA.
const CHANNELS_OF_COLOUR_TYPE = new Map([
  [2, 3],
  [COLOUR_TYPE_RGBA, 4],
]);
const NOT_INTERLACED = 0;
// An APNG's delays are a fraction: the frame's milliseconds over a thousand, both 16 bits.
const MS_IN_A_SECOND = 1000;
const LONGEST_DELAY_MS = 0xffff;
const PLAY_FOREVER = 0;
// Each frame replaces its region (APNG_BLEND_OP_SOURCE) and is left as it is after it
// (APNG_DISPOSE_OP_NONE): the next frame draws over it only what changed.
const DISPOSE_NONE = 0;
const BLEND_SOURCE = 0;

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
  const rows = unfilter(inflateSync(Buffer.concat(data)), width * channels, height, channels);
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

// The rows of a region, each under the filter that leaves it the smallest sum, as PNG's own
// writers choose: a capture's flat colours shrink most under Sub or Up.
function filteredRows({ width, rgba }: Picture, region: Region): Buffer {
  const stride = region.width * 4;
  const raw = new Uint8Array(stride * region.height);
  for (let y = 0; y < region.height; y++) {
    const start = ((region.y + y) * width + region.x) * 4;
    raw.set(rgba.subarray(start, start + stride), y * stride);
  }
  const out = Buffer.alloc((stride + 1) * region.height);
  const candidate = new Uint8Array(stride);
  for (let y = 0; y < region.height; y++) {
    let best = { filter: 0, sum: Infinity, bytes: new Uint8Array(0) };
    for (const filter of [0, 1, 2, 4]) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const left = i >= 4 ? (raw[y * stride + i - 4] ?? 0) : 0;
        const up = y > 0 ? (raw[(y - 1) * stride + i] ?? 0) : 0;
        const upLeft = y > 0 && i >= 4 ? (raw[(y - 1) * stride + i - 4] ?? 0) : 0;
        const value = ((raw[y * stride + i] ?? 0) - predicted(filter, left, up, upLeft)) & 0xff;
        candidate[i] = value;
        sum += value < 128 ? value : 256 - value;
      }
      if (sum < best.sum) best = { filter, sum, bytes: candidate.slice() };
    }
    out[y * (stride + 1)] = best.filter;
    out.set(best.bytes, y * (stride + 1) + 1);
  }
  return out;
}

// The smallest rectangle that holds every pixel that differs, or none.
function changed(before: Picture, after: Picture): Region | undefined {
  const { width, height } = after;
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (
        before.rgba[at] !== after.rgba[at] ||
        before.rgba[at + 1] !== after.rgba[at + 1] ||
        before.rgba[at + 2] !== after.rgba[at + 2] ||
        before.rgba[at + 3] !== after.rgba[at + 3]
      ) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  if (bottom < 0) return undefined;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

// An animated PNG that plays the frames in turn, forever. A frame writes only the region that
// changed since the one before, and a frame that changed nothing adds its time to that one.
export function encodeApng(frames: readonly Frame[]): Buffer {
  const [first] = frames;
  if (first === undefined) throw new Error('no picture to play');
  const { width, height } = first.picture;
  const kept: { picture: Picture; region: Region; ms: number }[] = [];
  for (const { picture, ms } of frames) {
    if (picture.width !== width || picture.height !== height)
      throw new Error(
        `a picture of ${String(picture.width)}×${String(picture.height)} among pictures of ${String(width)}×${String(height)}`,
      );
    const last = kept.at(-1);
    if (last === undefined) {
      kept.push({ picture, region: { x: 0, y: 0, width, height }, ms });
      continue;
    }
    const region = changed(last.picture, picture);
    if (region === undefined) last.ms += ms;
    else kept.push({ picture, region, ms });
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([BIT_DEPTH, COLOUR_TYPE_RGBA, 0, 0, NOT_INTERLACED], 8);
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(kept.length, 0);
  animation.writeUInt32BE(PLAY_FOREVER, 4);

  let sequence = 0;
  const chunks = [SIGNATURE, chunk('IHDR', header), chunk('acTL', animation)];
  kept.forEach(({ picture, region, ms }, index) => {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++, 0);
    control.writeUInt32BE(region.width, 4);
    control.writeUInt32BE(region.height, 8);
    control.writeUInt32BE(region.x, 12);
    control.writeUInt32BE(region.y, 16);
    control.writeUInt16BE(Math.min(Math.round(ms), LONGEST_DELAY_MS), 20);
    control.writeUInt16BE(MS_IN_A_SECOND, 22);
    control.set([DISPOSE_NONE, BLEND_SOURCE], 24);
    chunks.push(chunk('fcTL', control));
    const data = deflateSync(filteredRows(picture, region), { level: 9 });
    if (index === 0) chunks.push(chunk('IDAT', data));
    else {
      const numbered = Buffer.alloc(4 + data.length);
      numbered.writeUInt32BE(sequence++, 0);
      data.copy(numbered, 4);
      chunks.push(chunk('fdAT', numbered));
    }
  });
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}
