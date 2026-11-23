import { type FileHandle, open, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  compactSegments,
  downloadedBytes,
  DownloadFailure,
  isComplete,
  positionOf,
  remainingBytes,
  type Segment,
  splitLargest,
} from '@scia/core';
import { DiskError, RemoteError, type RemoteSource, type RequestHeaders } from './remote-source.ts';
import type { MarkSparse } from './sparse-file.ts';
import type { Allowance } from './throttle.ts';

// A connection that finished its range takes over half of another only when at least this much
// is left for each: below it, the handshake costs more than it saves.
const MIN_SPLIT_BYTES = 1024 * 1024;
// Bytes are written in batches: one write per chunk would queue thousands of tiny disk
// operations behind the four threads Node gives them.
const FLUSH_BYTES = 256 * 1024;
// On a slow line a batch never fills: it is written anyway, so the progress keeps moving.
const FLUSH_INTERVAL_MS = 200;
// Failures in a row without a byte in between, per connection.
const MAX_ATTEMPTS = 5;

function defaultRetryDelayMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1));
}

export interface TaskOptions {
  readonly source: RemoteSource;
  readonly url: string;
  readonly headers: RequestHeaders;
  // The file the bytes land in until the download is whole.
  readonly partPath: string;
  readonly totalBytes: number | null;
  // The host serves ranges and says the size: connections in parallel, and a pause keeps its bytes.
  readonly resumable: boolean;
  readonly connections: number;
  readonly segments: readonly Segment[];
  readonly onBytes: (count: number) => void;
  // The speed limit: what a connection books of it before each read, from before it asks its
  // host to its last read (throttle.ts). It is told how much the connection's range can bring,
  // when the host says.
  readonly allowance?: (expectedBytes: number | null) => Allowance;
  readonly retryDelayMs?: (attempt: number) => number;
  // Asked of a ranged part file the task makes, while it is empty (sparse-file.ts). Unset, the
  // file stays as the system makes it.
  readonly markSparse?: MarkSparse;
  // The room left on the disk of a folder; the system's, unless a spec says otherwise.
  readonly freeBytes?: (folder: string) => Promise<number>;
}

async function roomOf(folder: string): Promise<number> {
  const disk = await statfs(folder);
  return disk.bavail * disk.bsize;
}

export interface TaskProgress {
  readonly segments: Segment[];
  readonly downloadedBytes: number;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function onDisk<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new DiskError('The file could not be written.', { cause: error });
  }
}

async function writeFully(file: FileHandle, data: Uint8Array, position: number): Promise<void> {
  await onDisk(async () => {
    let offset = 0;
    while (offset < data.byteLength) {
      const { bytesWritten } = await file.write(
        data,
        offset,
        data.byteLength - offset,
        position + offset,
      );
      offset += bytesWritten;
    }
  });
}

// One download, from the bytes it already has to its last: the connections, their ranges, the
// retries, the writes. It knows nothing of queues or names (download-manager.ts).
export class DownloadTask {
  readonly #options: TaskOptions;
  #segments: Segment[];
  #wholeBytes = 0;
  readonly #claimed = new Set<number>();
  #file: FileHandle | undefined;

  constructor(options: TaskOptions) {
    this.#options = options;
    this.#segments = [...options.segments];
  }

  get #ranged(): boolean {
    return this.#options.resumable && this.#options.totalBytes !== null;
  }

  progress(): TaskProgress {
    if (this.#ranged) {
      const segments = compactSegments(this.#segments);
      return { segments, downloadedBytes: downloadedBytes(segments) };
    }
    const total = this.#options.totalBytes;
    return {
      segments:
        total === null
          ? []
          : [{ start: 0, end: total, downloaded: Math.min(this.#wholeBytes, total) }],
      downloadedBytes: this.#wholeBytes,
    };
  }

  // Resolves with every byte on disk; rejects with the abort's reason, a RemoteError or a
  // DiskError, and progress() then says what was kept.
  async run(signal: AbortSignal): Promise<void> {
    const file = await this.#openPart();
    this.#file = file;
    try {
      if (this.#ranged) {
        await this.#runConnections(file, signal);
      } else {
        await this.#runWhole(file, signal);
      }
      await onDisk(() => file.datasync());
    } finally {
      this.#file = undefined;
      await file.close();
    }
  }

  // What progress() says is on disk is on disk after this, power cut included.
  async sync(): Promise<void> {
    await this.#file?.datasync();
  }

  async #openPart(): Promise<FileHandle> {
    const kept = await onDisk(() => this.#openKept());
    // Only a part file about to be made, before it is: a download refused for its room leaves
    // nothing on the disk. A kept one had its room looked at when it was made — or taken, made
    // dense — and what it has not written yet is no room it still needs.
    if (this.#ranged && kept === undefined) await this.#roomForTheRest();
    const file = kept ?? (await onDisk(() => open(this.#options.partPath, 'w+')));
    try {
      // A ranged part file is the file's length: the whole size at once when it is made, kept
      // at whatever an earlier attempt left — when the host's file got smaller and the download
      // started over, the old file's tail would stay past the new end (#106). The segments hold
      // only bytes inside it. It is made sparse before its size is set — a new one while it is
      // empty — so that a write far into it does not wait for the zeros before it
      // (docs/adr/0026). A kept one is asked again, which changes nothing of one already sparse.
      if (this.#ranged) {
        const markSparse = this.#options.markSparse;
        if (markSparse !== undefined) await onDisk(() => markSparse(this.#options.partPath));
        await onDisk(() => file.truncate(this.#options.totalBytes ?? 0));
      }
    } catch (error) {
      await file.close();
      throw error;
    }
    return file;
  }

  // A sparse file takes its room as its bytes arrive, so the room is not reserved: it is looked
  // at, so that a full disk is still said before a byte is fetched. What another download or
  // program writes afterwards is said by the write that finds the disk full, and so is the room of
  // a disk that does not say it.
  async #roomForTheRest(): Promise<void> {
    const room = await (this.#options.freeBytes ?? roomOf)(dirname(this.#options.partPath)).catch(
      () => null,
    );
    const toCome = this.#segments.reduce((sum, segment) => sum + remainingBytes(segment), 0);
    if (room !== null && room < toCome) throw new DiskError('The disk has no room for the file.');
  }

  async #openKept(): Promise<FileHandle | undefined> {
    try {
      return await open(this.#options.partPath, 'r+');
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    // The part file is gone, and with it what the segments remember.
    this.#segments = this.#segments.map((segment) => ({ ...segment, downloaded: 0 }));
    return undefined;
  }

  async #runConnections(file: FileHandle, signal: AbortSignal): Promise<void> {
    const failure = new AbortController();
    const stop = AbortSignal.any([signal, failure.signal]);
    let cause: Error | undefined;
    const connections = Array.from({ length: Math.max(1, this.#options.connections) }, async () => {
      try {
        await this.#connection(file, stop);
      } catch (error) {
        if (stop.aborted) return;
        // The first connection out of attempts ends the others: the download failed as one.
        cause = toError(error);
        failure.abort();
      }
    });
    await Promise.all(connections);
    signal.throwIfAborted();
    if (cause !== undefined) throw cause;
    if (!isComplete(this.#segments)) {
      throw new RemoteError(DownloadFailure.Incomplete, true, 'Some ranges never arrived.');
    }
  }

  async #connection(file: FileHandle, signal: AbortSignal): Promise<void> {
    for (;;) {
      const index = this.#claim();
      if (index === undefined) return;
      try {
        await this.#fetchSegment(index, file, signal);
      } finally {
        this.#claimed.delete(index);
      }
    }
  }

  // A range nobody is fetching, or the second half of the one with the most left.
  #claim(): number | undefined {
    for (const [index, segment] of this.#segments.entries()) {
      if (!this.#claimed.has(index) && remainingBytes(segment) > 0) {
        this.#claimed.add(index);
        return index;
      }
    }
    const split = splitLargest(this.#segments, MIN_SPLIT_BYTES);
    if (split === undefined) return undefined;
    this.#segments[split.index] = split.shrunk;
    const index = this.#segments.push(split.added) - 1;
    this.#claimed.add(index);
    return index;
  }

  #segment(index: number): Segment {
    const segment = this.#segments[index];
    if (segment === undefined) throw new Error(`No segment ${String(index)}.`);
    return segment;
  }

  async #fetchSegment(index: number, file: FileHandle, signal: AbortSignal): Promise<void> {
    let failures = 0;
    for (;;) {
      const before = this.#segment(index).downloaded;
      try {
        await this.#streamSegment(index, file, signal);
        if (remainingBytes(this.#segment(index)) === 0) return;
        throw new RemoteError(DownloadFailure.Incomplete, true, 'The host closed the range early.');
      } catch (error) {
        if (signal.aborted || !(error instanceof RemoteError) || !error.retryable) throw error;
        failures = this.#segment(index).downloaded > before ? 1 : failures + 1;
        if (failures >= MAX_ATTEMPTS) throw error;
        await sleep(this.#retryDelayMs(failures), undefined, { signal });
      }
    }
  }

  #retryDelayMs(attempt: number): number {
    return (this.#options.retryDelayMs ?? defaultRetryDelayMs)(attempt);
  }

  async #streamSegment(index: number, file: FileHandle, signal: AbortSignal): Promise<void> {
    const allowance = this.#options.allowance?.(remainingBytes(this.#segment(index)));
    try {
      // Before the host is asked, not after: a connection is not opened to be left unread.
      await allowance?.next().over(signal);
      await this.#streamBooked(index, file, signal, allowance);
    } finally {
      allowance?.settle();
    }
  }

  async #streamBooked(
    index: number,
    file: FileHandle,
    signal: AbortSignal,
    allowance: Allowance | undefined,
  ): Promise<void> {
    const asked = this.#segment(index);
    const body = await this.#options.source.open(
      this.#options.url,
      this.#options.headers,
      { start: positionOf(asked), end: asked.end },
      signal,
    );
    const pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let flushedAt = performance.now();

    // Writes what is pending and answers whether the segment is whole. The segment is read anew
    // around the write: another connection may have taken its second half meanwhile, and what
    // was written past the new end is that connection's to count.
    const flush = async (): Promise<boolean> => {
      const segment = this.#segment(index);
      const bytes = Math.min(pendingBytes, remainingBytes(segment));
      if (bytes > 0) {
        const data = Buffer.concat(pending, pendingBytes).subarray(0, bytes);
        await writeFully(file, data, positionOf(segment));
        const latest = this.#segment(index);
        const counted = Math.min(bytes, remainingBytes(latest));
        this.#segments[index] = { ...latest, downloaded: latest.downloaded + counted };
        this.#options.onBytes(counted);
      }
      pending.length = 0;
      pendingBytes = 0;
      flushedAt = performance.now();
      return remainingBytes(this.#segment(index)) === 0;
    };

    try {
      for await (const chunk of body) {
        allowance?.took(chunk.byteLength);
        pending.push(chunk);
        pendingBytes += chunk.byteLength;
        const whole = pendingBytes >= remainingBytes(this.#segment(index));
        // Nothing is booked for a read that will not be made.
        const hold = whole ? undefined : allowance?.next();
        const due =
          pendingBytes >= FLUSH_BYTES ||
          whole ||
          performance.now() - flushedAt >= FLUSH_INTERVAL_MS ||
          // What arrived is not kept in memory, unwritten and uncounted, for a wait this long.
          (hold !== undefined && hold.ms >= FLUSH_INTERVAL_MS);
        // Leaving the loop closes the connection: the range it was asked may be longer than
        // what is left to this segment after a split.
        if (due && (await flush())) return;
        await hold?.over(signal);
      }
      await flush();
    } catch (error) {
      if (error instanceof DiskError) throw error;
      // What arrived before the cut is kept: the next attempt, or the resume, starts after it.
      await flush().catch(() => undefined);
      if (signal.aborted || error instanceof RemoteError) throw error;
      throw new RemoteError(DownloadFailure.Network, true, 'The connection dropped.', {
        cause: error,
      });
    }
  }

  // A host without ranges, or without a size: one connection, from the first byte every time.
  async #runWhole(file: FileHandle, signal: AbortSignal): Promise<void> {
    let failures = 0;
    for (;;) {
      try {
        await this.#streamWhole(file, signal);
        return;
      } catch (error) {
        if (signal.aborted || !(error instanceof RemoteError) || !error.retryable) throw error;
        failures += 1;
        if (failures >= MAX_ATTEMPTS) throw error;
        await sleep(this.#retryDelayMs(failures), undefined, { signal });
      }
    }
  }

  async #streamWhole(file: FileHandle, signal: AbortSignal): Promise<void> {
    const allowance = this.#options.allowance?.(this.#options.totalBytes);
    try {
      await allowance?.next().over(signal);
      await this.#streamWholeBooked(file, signal, allowance);
    } finally {
      allowance?.settle();
    }
  }

  async #streamWholeBooked(
    file: FileHandle,
    signal: AbortSignal,
    allowance: Allowance | undefined,
  ): Promise<void> {
    this.#wholeBytes = 0;
    // Before the host is asked: nothing stands between its answer and the reading of it, where
    // a failure would leave the connection open and unread.
    await onDisk(() => file.truncate(0));
    const body = await this.#options.source.open(
      this.#options.url,
      this.#options.headers,
      null,
      signal,
    );
    const total = this.#options.totalBytes;
    try {
      for await (const chunk of body) {
        await writeFully(file, chunk, this.#wholeBytes);
        this.#wholeBytes += chunk.byteLength;
        this.#options.onBytes(chunk.byteLength);
        allowance?.took(chunk.byteLength);
        // A file that is whole books nothing more. A host that does not say the size has one
        // more read booked and waited for: only that read tells that the last was the last.
        if (this.#wholeBytes !== total) await allowance?.next().over(signal);
      }
    } catch (error) {
      if (error instanceof DiskError || error instanceof RemoteError || signal.aborted) throw error;
      throw new RemoteError(DownloadFailure.Network, true, 'The connection dropped.', {
        cause: error,
      });
    }
    if (total !== null && this.#wholeBytes !== total) {
      throw new RemoteError(DownloadFailure.Incomplete, true, 'The host closed the file early.');
    }
  }
}
