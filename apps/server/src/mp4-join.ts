import { type FileHandle, open } from 'node:fs/promises';
import {
  BOXES_READ,
  boxHeaderOf,
  joinPlan,
  Mp4Error,
  Mp4Refusal,
  type Mp4Source,
  PageFailure,
  type TopBox,
} from '@scia/core';
import { PageError } from './media-choice.ts';
import { DiskError } from './remote-source.ts';

// A movie or a fragment's header is read whole: tens of kilobytes, a few megabytes for hours of
// a movie that is not fragmented. Never this.
const MOST_READ_BYTES = 64 * 1024 * 1024;
// What a file of the two may hold in boxes: hours of fragments of a second or two.
const MOST_BOXES = 1_000_000;
// What is copied at a time.
const COPY_BYTES = 1024 * 1024;

async function onDisk<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PageError) throw error;
    throw new DiskError('The joined file could not be made.', { cause: error });
  }
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(bytes, offset, length - offset, position + offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return bytes.subarray(0, offset);
}

async function writeAll(file: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      position + offset,
    );
    offset += bytesWritten;
  }
}

// The boxes of a file, read by their headers, with the contents of those the plan reads.
async function sourceOf(file: FileHandle): Promise<Mp4Source> {
  const { size } = await file.stat();
  const boxes: TopBox[] = [];
  const contents = new Map<number, Uint8Array>();
  let start = 0;
  while (start < size) {
    if (boxes.length >= MOST_BOXES) throw new Mp4Error(Mp4Refusal.Unsupported, 'Too many boxes.');
    const header = boxHeaderOf(await readAt(file, start, 16), size - start);
    const box = { ...header, start };
    boxes.push(box);
    if (BOXES_READ.has(box.type)) {
      if (box.size > MOST_READ_BYTES)
        throw new Mp4Error(Mp4Refusal.Unsupported, 'A box is too big.');
      contents.set(start, await readAt(file, start, box.size));
    }
    start += box.size;
  }
  return { boxes, contents };
}

function pageErrorOf(error: Mp4Error): PageError {
  return error.refusal === Mp4Refusal.Unsupported
    ? new PageError(PageFailure.FormatUnsupported, error.message, { cause: error })
    : new PageError(PageFailure.Unreadable, error.message, { cause: error });
}

// The picture and the sound made into one mp4 at `outPath` (docs/adr/0021), synced to the disk:
// written anew, whatever was there. Rejects with a PageError for files Scia does not join, a
// DiskError for the disk, or the reason of `signal`.
export async function joinIntoMp4(
  picturePath: string,
  soundPath: string,
  outPath: string,
  signal: AbortSignal,
): Promise<void> {
  const picture = await onDisk(() => open(picturePath, 'r'));
  try {
    const sound = await onDisk(() => open(soundPath, 'r'));
    try {
      let plan;
      try {
        plan = joinPlan(await onDisk(() => sourceOf(picture)), await onDisk(() => sourceOf(sound)));
      } catch (error) {
        if (error instanceof Mp4Error) throw pageErrorOf(error);
        throw error;
      }
      const out = await onDisk(() => open(outPath, 'w'));
      try {
        let position = 0;
        for (const written of plan) {
          signal.throwIfAborted();
          if (written.kind === 'bytes') {
            await onDisk(() => writeAll(out, written.bytes, position));
            position += written.bytes.byteLength;
            continue;
          }
          const from = written.from === 'picture' ? picture : sound;
          for (let at = written.start; at < written.end; at += COPY_BYTES) {
            signal.throwIfAborted();
            const length = Math.min(COPY_BYTES, written.end - at);
            const bytes = await onDisk(() => readAt(from, at, length));
            if (bytes.byteLength !== length) {
              throw new PageError(PageFailure.Unreadable, 'A file of the two is cut short.');
            }
            await onDisk(() => writeAll(out, bytes, position));
            position += length;
          }
        }
        await onDisk(() => out.datasync());
      } finally {
        await out.close();
      }
    } finally {
      await sound.close();
    }
  } finally {
    await picture.close();
  }
}
