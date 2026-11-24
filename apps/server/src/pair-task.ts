import { rm } from 'node:fs/promises';
import { downloadedBytes, PageFailure, type Segment } from '@scia/core';
import { DownloadTask, type TaskOptions } from './download-task.ts';
import { PageError } from './media-choice.ts';
import { joinIntoMp4 } from './mp4-join.ts';
import { DiskError, type RemoteSource, type RequestHeaders } from './remote-source.ts';
import type { MarkSparse } from './sparse-file.ts';
import type { Allowance } from './throttle.ts';

// Where a pair's two files wait beside the part file until they are joined.
export const pictureOf = (partPath: string) => `${partPath}.picture`;
export const soundOf = (partPath: string) => `${partPath}.sound`;

export interface PairFile {
  readonly url: string;
  readonly headers: RequestHeaders;
  readonly totalBytes: number | null;
  readonly resumable: boolean;
}

export interface PairTaskOptions {
  readonly source: RemoteSource;
  readonly picture: PairFile;
  readonly sound: PairFile;
  // Where the joined mp4 is made.
  readonly partPath: string;
  readonly connections: number;
  // The segments of both files on one line: the picture's bytes, then the sound's.
  readonly segments: readonly Segment[];
  readonly onBytes: (count: number) => void;
  readonly allowance?: (expectedBytes: number | null) => Allowance;
  readonly retryDelayMs?: (attempt: number) => number;
  // Asked of each of the two files when it is made (sparse-file.ts).
  readonly markSparse?: MarkSparse;
}

const shifted = (segments: readonly Segment[], by: number): Segment[] =>
  segments.map((segment) => ({ ...segment, start: segment.start + by, end: segment.end + by }));

// The segments of the line that fall in [from, to), cut at its ends and counted from `from`: a
// segment over the line between the two files is two segments, its bytes on disk the first's
// first.
function partOf(segments: readonly Segment[], from: number, to: number): Segment[] {
  const part: Segment[] = [];
  for (const segment of segments) {
    const start = Math.max(segment.start, from);
    const end = Math.min(segment.end, to);
    if (start >= end) continue;
    const done = Math.min(Math.max(segment.start + segment.downloaded - start, 0), end - start);
    part.push({ start: start - from, end: end - from, downloaded: done });
  }
  return part;
}

// A page's picture and its sound, offered apart (docs/adr/0021): each fetched as a file is —
// several connections, the one speed limit, a pause that keeps its bytes — the picture first,
// into files beside the part file; then joined into one mp4 in the part file, nothing re-encoded,
// and the two files removed.
export class PairTask {
  readonly #options: PairTaskOptions;
  readonly #picture: DownloadTask;
  readonly #sound: DownloadTask;

  constructor(options: PairTaskOptions) {
    this.#options = options;
    const split = options.picture.totalBytes;
    const fileOf = (file: PairFile, partPath: string, segments: Segment[]): TaskOptions => ({
      source: options.source,
      url: file.url,
      headers: file.headers,
      partPath,
      totalBytes: file.totalBytes,
      resumable: file.resumable,
      connections: options.connections,
      segments,
      onBytes: options.onBytes,
      ...(options.allowance === undefined ? {} : { allowance: options.allowance }),
      ...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
      ...(options.markSparse === undefined ? {} : { markSparse: options.markSparse }),
    });
    const ranged = split !== null && options.sound.totalBytes !== null;
    this.#picture = new DownloadTask(
      fileOf(
        options.picture,
        pictureOf(options.partPath),
        ranged ? partOf(options.segments, 0, split) : [],
      ),
    );
    this.#sound = new DownloadTask(
      fileOf(
        options.sound,
        soundOf(options.partPath),
        ranged ? partOf(options.segments, split, split + options.sound.totalBytes) : [],
      ),
    );
  }

  progress(): { readonly segments: Segment[]; readonly downloadedBytes: number } {
    const picture = this.#picture.progress();
    const sound = this.#sound.progress();
    const split = this.#options.picture.totalBytes;
    const segments =
      split === null || this.#options.sound.totalBytes === null
        ? []
        : [...picture.segments, ...shifted(sound.segments, split)];
    return {
      segments,
      downloadedBytes:
        segments.length > 0
          ? downloadedBytes(segments)
          : picture.downloadedBytes + sound.downloadedBytes,
    };
  }

  // What progress() says is on disk is on disk after this: the file being fetched is synced, and
  // the one fetched before it was synced at its end.
  async sync(): Promise<void> {
    await this.#picture.sync();
    await this.#sound.sync();
  }

  async run(signal: AbortSignal): Promise<void> {
    await this.#picture.run(signal);
    await this.#sound.run(signal);
    const { partPath } = this.#options;
    // A refusal of what the two files hold, whichever: fetched again, they would hold the same.
    await joinIntoMp4(pictureOf(partPath), soundOf(partPath), partPath, signal).catch(
      (error: unknown) => {
        if (!(error instanceof PageError)) throw error;
        throw new PageError(PageFailure.NotJoined, error.message, { cause: error });
      },
    );
    try {
      await rm(pictureOf(partPath), { force: true });
      await rm(soundOf(partPath), { force: true });
    } catch (error) {
      throw new DiskError('The files of the picture and the sound could not be removed.', {
        cause: error,
      });
    }
  }
}
