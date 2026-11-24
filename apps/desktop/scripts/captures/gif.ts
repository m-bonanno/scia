import type { Picture } from './decode-png.ts';

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

interface Kept {
  readonly picture: Picture;
  readonly region: Region;
  ms: number;
}

const HEADER = Buffer.from('GIF89a', 'latin1');
const TRAILER = Buffer.from([0x3b]);
// The logical screen has no colour table of its own (each frame carries one) and 8 bits a colour.
const SCREEN_FLAGS = 0x70;
// NETSCAPE2.0's loop count is how many times the frames play again after the first, in 16 bits,
// and 0 is forever; a GIF without the extension plays once. Chromium plays a GIF so (seen in #322);
// WebKit's r230712 and Firefox's tests say they count so (read, not run).
const NETSCAPE = Buffer.concat([
  Buffer.from([0x21, 0xff, 0x0b]),
  Buffer.from('NETSCAPE2.0', 'latin1'),
  Buffer.from([0x03, 0x01]),
]);
const MOST_PLAYS = 0xffff + 1;
const MOST_COLOURS = 256;
// A frame's time is hundredths of a second, in 16 bits.
const MS_IN_A_DELAY = 10;
const LONGEST_DELAY = 0xffff;
// Each frame is left as it is after it (disposal 1, "do not dispose"): the next draws over it only
// what changed, and the pixels of its region that did not change are transparent.
const DO_NOT_DISPOSE = 1 << 2;
const HAS_TRANSPARENCY = 1;
const HAS_COLOUR_TABLE = 0x80;
// LZW's codes are 12 bits at most: past 4096 codes the table is started again.
const CODES = 4096;
const MOST_IN_A_BLOCK = 255;

const colourAt = (rgba: Uint8Array, pixel: number) =>
  ((rgba[pixel * 4] ?? 0) << 16) | ((rgba[pixel * 4 + 1] ?? 0) << 8) | (rgba[pixel * 4 + 2] ?? 0);

// A GIF that plays the frames in turn as many times as asked, then shows its last. Each frame writes
// only the region that changed since the one before, and a frame that changed nothing adds its time
// to that one. A GIF holds 256 colours a frame and no partial transparency: a picture that needs
// more is refused, not changed.
export function encodeGif(frames: readonly Frame[], { plays }: { readonly plays: number }): Buffer {
  const [first] = frames;
  if (first === undefined) throw new Error('no picture to play');
  if (!Number.isInteger(plays) || plays < 1 || plays > MOST_PLAYS)
    throw new Error(
      `${String(plays)} plays, where a GIF plays from 1 to ${String(MOST_PLAYS)} times`,
    );
  const { width, height } = first.picture;
  const kept: Kept[] = [];
  for (const { picture, ms } of frames) {
    if (picture.width !== width || picture.height !== height)
      throw new Error(
        `a picture of ${String(picture.width)}×${String(picture.height)} among pictures of ${String(width)}×${String(height)}`,
      );
    for (let at = 3; at < picture.rgba.length; at += 4)
      if (picture.rgba[at] !== 0xff) throw new Error('a pixel that is not opaque');
    const last = kept.at(-1);
    if (last === undefined) {
      kept.push({ picture, region: { x: 0, y: 0, width, height }, ms });
      continue;
    }
    const region = changed(last.picture, picture);
    if (region === undefined) last.ms += ms;
    else kept.push({ picture, region, ms });
  }

  const screen = Buffer.alloc(7);
  screen.writeUInt16LE(width, 0);
  screen.writeUInt16LE(height, 2);
  screen[4] = SCREEN_FLAGS;
  const parts: Buffer[] = [HEADER, screen];
  if (plays > 1) {
    // The loop count, then the empty sub-block that ends the extension.
    const loopCount = Buffer.alloc(3);
    loopCount.writeUInt16LE(plays - 1, 0);
    parts.push(NETSCAPE, loopCount);
  }
  let elapsedMs = 0;
  let shown = 0;
  kept.forEach(({ picture, region, ms }, index) => {
    elapsedMs += ms;
    const delay = Math.round(elapsedMs / MS_IN_A_DELAY) - shown;
    if (delay > LONGEST_DELAY)
      throw new Error(
        `a frame of ${String(ms)} ms, where a GIF holds ${String(LONGEST_DELAY * MS_IN_A_DELAY)}`,
      );
    shown += delay;
    const { palette, indices, transparent } = indexed(picture, region, kept[index - 1]?.picture);
    const bits = Math.max(
      1,
      Math.ceil(Math.log2(palette.length + (transparent === undefined ? 0 : 1))),
    );
    const control = Buffer.from([0x21, 0xf9, 0x04, DO_NOT_DISPOSE, 0, 0, transparent ?? 0, 0]);
    if (transparent !== undefined) control[3] = DO_NOT_DISPOSE | HAS_TRANSPARENCY;
    control.writeUInt16LE(delay, 4);
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(region.x, 1);
    descriptor.writeUInt16LE(region.y, 3);
    descriptor.writeUInt16LE(region.width, 5);
    descriptor.writeUInt16LE(region.height, 7);
    descriptor[9] = HAS_COLOUR_TABLE | (bits - 1);
    const table = Buffer.alloc(3 << bits);
    palette.forEach((colour, entry) => {
      table.set([colour >> 16, (colour >> 8) & 0xff, colour & 0xff], entry * 3);
    });
    const minCodeSize = Math.max(2, bits);
    parts.push(
      control,
      descriptor,
      table,
      Buffer.from([minCodeSize]),
      blocks(lzw(indices, minCodeSize)),
    );
  });
  parts.push(TRAILER);
  return Buffer.concat(parts);
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
      if (colourAt(before.rgba, y * width + x) !== colourAt(after.rgba, y * width + x)) {
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

// The region's pixels as entries of a palette. Those that did not change since the picture before
// are transparent, when the palette has room for one more entry; else every pixel is written.
function indexed(
  picture: Picture,
  region: Region,
  before: Picture | undefined,
): { palette: number[]; indices: Uint8Array; transparent: number | undefined } {
  const pixels: number[] = [];
  for (let y = region.y; y < region.y + region.height; y++)
    for (let x = region.x; x < region.x + region.width; x++) pixels.push(y * picture.width + x);
  const same = (pixel: number) =>
    before !== undefined && colourAt(before.rgba, pixel) === colourAt(picture.rgba, pixel);
  const coloursOf = (written: readonly number[]) => [
    ...new Set(written.map((pixel) => colourAt(picture.rgba, pixel))),
  ];
  const changedColours = coloursOf(pixels.filter((pixel) => !same(pixel)));
  const withTransparency = before !== undefined && changedColours.length < MOST_COLOURS;
  const palette = withTransparency ? changedColours : coloursOf(pixels);
  if (palette.length > MOST_COLOURS)
    throw new Error(
      `a frame of ${String(palette.length)} colours, where a GIF holds ${String(MOST_COLOURS)}`,
    );
  const entryOf = new Map(palette.map((colour, entry) => [colour, entry]));
  const transparent = withTransparency ? palette.length : undefined;
  const indices = Uint8Array.from(pixels, (pixel) =>
    transparent !== undefined && same(pixel)
      ? transparent
      : (entryOf.get(colourAt(picture.rgba, pixel)) ?? 0),
  );
  return { palette, indices, transparent };
}

// GIF's variable-length LZW: codes from minCodeSize + 1 bits up to 12, least significant bit first.
function lzw(indices: Uint8Array, minCodeSize: number): Buffer {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let bits = 0;
  let held = 0;
  let size = minCodeSize + 1;
  const write = (code: number) => {
    bits |= code << held;
    held += size;
    while (held >= 8) {
      out.push(bits & 0xff);
      bits >>>= 8;
      held -= 8;
    }
  };
  let table = new Map<number, number>();
  let next = end + 1;
  write(clear);
  let prefix = indices[0] ?? 0;
  for (let i = 1; i < indices.length; i++) {
    const index = indices[i] ?? 0;
    const key = (prefix << 8) | index;
    const code = table.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    write(prefix);
    if (next === CODES) {
      write(clear);
      table = new Map();
      next = end + 1;
      size = minCodeSize + 1;
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = index;
  }
  write(prefix);
  write(end);
  if (held > 0) out.push(bits & 0xff);
  return Buffer.from(out);
}

// Image data in sub-blocks of 255 bytes at most, ended by an empty one.
function blocks(data: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (let at = 0; at < data.length; at += MOST_IN_A_BLOCK) {
    const part = data.subarray(at, at + MOST_IN_A_BLOCK);
    parts.push(Buffer.from([part.length]), part);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}
