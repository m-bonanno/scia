import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type Download, type Settings, type SettingsPatch, type Snapshot } from '@scia/contracts';
import {
  canPause,
  canResume,
  DownloadFailure,
  DownloadStatus,
  etaSeconds,
  fileKindOfName,
  fileNameFromUrl,
  nextToStart,
  planSegments,
  SpeedMeter,
  uniqueFileName,
} from '@scia/core';
import { DownloadTask } from './download-task.ts';
import { describeFailure, type Logger } from './logger.ts';
import {
  DiskError,
  RemoteError,
  type RemoteFile,
  type RemoteSource,
  type RequestHeaders,
} from './remote-source.ts';
import type { DownloadRecord, StateStore } from './state-store.ts';

export const PART_SUFFIX = '.scia';

const DEFAULT_SETTINGS = { maxConcurrentDownloads: 3, connectionsPerDownload: 8 } as const;
// A connection is not opened for less than this.
const MIN_SEGMENT_BYTES = 1024 * 1024;
const CHECKPOINT_MS = 5000;

export const ManagerRefusal = { NotFound: 'NOT_FOUND', Conflict: 'CONFLICT' } as const;
export type ManagerRefusal = (typeof ManagerRefusal)[keyof typeof ManagerRefusal];

export class ManagerError extends Error {
  override readonly name = 'ManagerError';
  readonly refusal: ManagerRefusal;

  constructor(refusal: ManagerRefusal, message: string) {
    super(message);
    this.refusal = refusal;
  }
}

export interface ManagerDeps {
  readonly source: RemoteSource;
  readonly store: StateStore;
  readonly defaultDirectory: string;
  readonly logger: Logger;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly checkpointMs?: number;
  readonly retryDelayMs?: (attempt: number) => number;
}

// Why a running download is being stopped, which decides what it is afterwards.
const StopIntent = { Pause: 'pause', Remove: 'remove', Shutdown: 'shutdown' } as const;
type StopIntent = (typeof StopIntent)[keyof typeof StopIntent];

interface Running {
  readonly controller: AbortController;
  readonly meter: SpeedMeter;
  task: DownloadTask | undefined;
  intent: StopIntent | undefined;
  settled: Promise<void>;
}

function headersOf(record: DownloadRecord): RequestHeaders {
  return record.referrer === null ? {} : { referer: record.referrer };
}

function partPathOf(record: DownloadRecord): string {
  return join(record.directory, `${record.fileName}${PART_SUFFIX}`);
}

// The queue, the names, the state on disk. What a single download does on the network and the
// disk is DownloadTask's.
export class DownloadManager {
  readonly #deps: ManagerDeps;
  readonly #records: DownloadRecord[];
  #settings: Settings;
  readonly #running = new Map<string, Running>();
  #version = 0;
  #waiters: (() => void)[] = [];
  #checkpoint: ReturnType<typeof setInterval> | undefined;
  #checkpointing = false;
  #closed = false;

  constructor(deps: ManagerDeps, records: DownloadRecord[], settings: Settings) {
    this.#deps = deps;
    this.#records = records;
    this.#settings = settings;
  }

  static async open(deps: ManagerDeps): Promise<DownloadManager> {
    const state = await deps.store.load();
    const records = (state?.downloads ?? []).map((record) =>
      // Running when the engine last stopped, whatever stopped it: it goes on by itself.
      record.status === DownloadStatus.Downloading
        ? { ...record, status: DownloadStatus.Queued }
        : record,
    );
    const settings = state?.settings ?? {
      ...DEFAULT_SETTINGS,
      downloadDirectory: deps.defaultDirectory,
    };
    const manager = new DownloadManager(deps, records, settings);
    manager.#schedule();
    return manager;
  }

  snapshot(): Snapshot {
    return { downloads: this.#records.map((record) => this.#view(record)) };
  }

  find(id: string): Download {
    return this.#view(this.#record(id));
  }

  // The version to pass next time. Resolves at once while a download runs (its progress never
  // stops changing), otherwise at the next change.
  nextChange(since: number): Promise<number> {
    if (this.#version > since || this.#running.size > 0 || this.#closed) {
      return Promise.resolve(this.#version);
    }
    return new Promise((resolve) => {
      this.#waiters.push(() => {
        resolve(this.#version);
      });
    });
  }

  add(input: {
    readonly urls: readonly string[];
    readonly referrer?: string | undefined;
  }): Download[] {
    const added = input.urls.map((url): DownloadRecord => {
      const record: DownloadRecord = {
        id: (this.#deps.newId ?? randomUUID)(),
        url,
        referrer: input.referrer ?? null,
        directory: this.#settings.downloadDirectory,
        fileName: fileNameFromUrl(url),
        named: false,
        status: DownloadStatus.Queued,
        totalBytes: null,
        resumable: false,
        validator: null,
        segments: [],
        downloadedBytes: 0,
        failure: null,
        failureStatus: null,
        createdAt: new Date(this.#now()).toISOString(),
        completedAt: null,
      };
      this.#records.push(record);
      return record;
    });
    this.#changed();
    this.#schedule();
    return added.map((record) => this.#view(record));
  }

  async pause(id: string): Promise<Download> {
    const record = this.#record(id);
    if (!canPause(record.status)) {
      throw new ManagerError(ManagerRefusal.Conflict, 'Only a waiting or running download pauses.');
    }
    const running = this.#running.get(id);
    if (running === undefined) {
      record.status = DownloadStatus.Paused;
      this.#changed();
    } else {
      await this.#stop(running, StopIntent.Pause);
    }
    return this.#view(record);
  }

  resume(id: string): Download {
    const record = this.#record(id);
    if (!canResume(record.status)) {
      throw new ManagerError(ManagerRefusal.Conflict, 'Only a paused or failed download resumes.');
    }
    record.status = DownloadStatus.Queued;
    record.failure = null;
    record.failureStatus = null;
    this.#changed();
    this.#schedule();
    return this.#view(record);
  }

  // The unfinished bytes always go; the finished file only when asked.
  async remove(id: string, deleteFile: boolean): Promise<void> {
    const record = this.#record(id);
    const running = this.#running.get(id);
    if (running !== undefined) await this.#stop(running, StopIntent.Remove);
    if (record.named) {
      if (record.status !== DownloadStatus.Completed) {
        await rm(partPathOf(record), { force: true });
      } else if (deleteFile) {
        await rm(join(record.directory, record.fileName), { force: true });
      }
    }
    this.#records.splice(this.#records.indexOf(record), 1);
    this.#changed();
    this.#schedule();
  }

  settings(): Settings {
    return this.#settings;
  }

  updateSettings(patch: SettingsPatch): Settings {
    this.#settings = {
      ...this.#settings,
      ...(patch.maxConcurrentDownloads === undefined
        ? {}
        : { maxConcurrentDownloads: patch.maxConcurrentDownloads }),
      ...(patch.connectionsPerDownload === undefined
        ? {}
        : { connectionsPerDownload: patch.connectionsPerDownload }),
    };
    this.#changed();
    this.#schedule();
    return this.#settings;
  }

  // Stops every transfer and writes the state. What was running goes on at the next start.
  async close(): Promise<void> {
    this.#closed = true;
    clearInterval(this.#checkpoint);
    this.#checkpoint = undefined;
    await Promise.all(
      [...this.#running.values()].map((running) => this.#stop(running, StopIntent.Shutdown)),
    );
    await this.#save();
    for (const wake of this.#waiters.splice(0)) wake();
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  #record(id: string): DownloadRecord {
    const record = this.#records.find((candidate) => candidate.id === id);
    if (record === undefined) throw new ManagerError(ManagerRefusal.NotFound, 'No such download.');
    return record;
  }

  #view(record: DownloadRecord): Download {
    const running = this.#running.get(record.id);
    const progress = running?.task?.progress() ?? record;
    const bytesPerSecond = running?.meter.bytesPerSecond(this.#now()) ?? 0;
    return {
      id: record.id,
      url: record.url,
      fileName: record.fileName,
      directory: record.directory,
      kind: fileKindOfName(record.fileName),
      status: record.status,
      totalBytes: record.totalBytes,
      downloadedBytes: progress.downloadedBytes,
      bytesPerSecond,
      etaSeconds:
        record.totalBytes === null || running === undefined
          ? null
          : etaSeconds(record.totalBytes - progress.downloadedBytes, bytesPerSecond),
      resumable: record.resumable,
      segments: progress.segments,
      failure: record.failure,
      failureStatus: record.failureStatus,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
    };
  }

  #changed(): void {
    this.#version += 1;
    for (const wake of this.#waiters.splice(0)) wake();
    void this.#save();
  }

  async #save(): Promise<void> {
    try {
      await this.#deps.store.save({
        version: 1,
        settings: this.#settings,
        downloads: this.#records,
      });
    } catch (error) {
      this.#deps.logger.error('state_not_saved', { error: describeFailure(error) });
    }
  }

  #schedule(): void {
    if (this.#closed) return;
    for (const id of nextToStart(this.#records, this.#settings.maxConcurrentDownloads)) {
      this.#start(this.#record(id));
    }
    this.#keepCheckpointing();
  }

  #keepCheckpointing(): void {
    if (this.#running.size > 0 && this.#checkpoint === undefined) {
      this.#checkpoint = setInterval(() => {
        void this.#checkpointNow();
      }, this.#deps.checkpointMs ?? CHECKPOINT_MS);
      this.#checkpoint.unref();
    } else if (this.#running.size === 0 && this.#checkpoint !== undefined) {
      clearInterval(this.#checkpoint);
      this.#checkpoint = undefined;
    }
  }

  // The state file never claims a byte the disk does not hold: sync first, then write.
  async #checkpointNow(): Promise<void> {
    if (this.#checkpointing) return;
    this.#checkpointing = true;
    try {
      for (const [id, running] of this.#running) {
        const record = this.#records.find((candidate) => candidate.id === id);
        if (running.task === undefined || record === undefined) continue;
        try {
          await running.task.sync();
        } catch {
          continue;
        }
        this.#keepProgress(record, running.task);
      }
      await this.#save();
    } finally {
      this.#checkpointing = false;
    }
  }

  #keepProgress(record: DownloadRecord, task: DownloadTask): void {
    const progress = task.progress();
    record.segments = progress.segments;
    record.downloadedBytes = progress.downloadedBytes;
  }

  async #stop(running: Running, intent: StopIntent): Promise<void> {
    running.intent = intent;
    running.controller.abort();
    await running.settled;
  }

  #start(record: DownloadRecord): void {
    record.status = DownloadStatus.Downloading;
    record.failure = null;
    record.failureStatus = null;
    const running: Running = {
      controller: new AbortController(),
      meter: new SpeedMeter(),
      task: undefined,
      intent: undefined,
      settled: Promise.resolve(),
    };
    this.#running.set(record.id, running);
    running.settled = this.#run(record, running);
    this.#changed();
  }

  async #run(record: DownloadRecord, running: Running): Promise<void> {
    const { signal } = running.controller;
    try {
      const remote = await this.#deps.source.probe(record.url, headersOf(record), signal);
      await mkdir(record.directory, { recursive: true }).catch((error: unknown) => {
        throw new DiskError('The folder could not be made.', { cause: error });
      });
      this.#adopt(record, remote);
      const task = new DownloadTask({
        source: this.#deps.source,
        url: record.url,
        headers: headersOf(record),
        partPath: partPathOf(record),
        totalBytes: record.totalBytes,
        resumable: record.resumable,
        connections: this.#settings.connectionsPerDownload,
        segments: record.segments,
        onBytes: (count) => {
          running.meter.record(count, this.#now());
        },
        ...(this.#deps.retryDelayMs === undefined ? {} : { retryDelayMs: this.#deps.retryDelayMs }),
      });
      running.task = task;
      this.#changed();
      await task.run(signal);
      this.#keepProgress(record, task);
      await this.#finish(record);
    } catch (error) {
      if (running.task !== undefined) this.#keepProgress(record, running.task);
      this.#settle(record, running, error);
    } finally {
      this.#running.delete(record.id);
      this.#changed();
      this.#schedule();
    }
  }

  #settle(record: DownloadRecord, running: Running, error: unknown): void {
    if (running.intent === StopIntent.Remove) return;
    if (running.intent === StopIntent.Pause) {
      record.status = DownloadStatus.Paused;
    } else if (running.intent === StopIntent.Shutdown) {
      record.status = DownloadStatus.Queued;
    } else {
      record.status = DownloadStatus.Failed;
      record.failure =
        error instanceof RemoteError
          ? error.failure
          : error instanceof DiskError
            ? DownloadFailure.Disk
            : DownloadFailure.Network;
      record.failureStatus = error instanceof RemoteError ? error.status : null;
      this.#deps.logger.warn('download_failed', {
        id: record.id,
        failure: record.failure,
        error: describeFailure(error),
      });
    }
  }

  // What the host says of the file, into the record: its name the first time, its size, whether
  // a pause keeps the bytes. A file that changed since the last attempt starts again.
  #adopt(record: DownloadRecord, remote: RemoteFile): void {
    if (!record.named) {
      record.fileName = this.#freeName(record, remote.fileName ?? record.fileName);
      record.named = true;
    }
    const changed =
      record.totalBytes !== remote.totalBytes ||
      (record.validator !== null &&
        remote.validator !== null &&
        record.validator !== remote.validator);
    record.totalBytes = remote.totalBytes;
    record.validator = remote.validator;
    record.resumable = remote.acceptsRanges && remote.totalBytes !== null;
    if (changed || !record.resumable) {
      record.segments = [];
      record.downloadedBytes = 0;
    }
    if (record.resumable && record.segments.length === 0 && remote.totalBytes !== null) {
      record.segments = planSegments(
        remote.totalBytes,
        this.#settings.connectionsPerDownload,
        MIN_SEGMENT_BYTES,
      );
    }
  }

  // Free in the folder and among the downloads still on their way there.
  #freeName(record: DownloadRecord, wanted: string): string {
    const reserved = new Set(
      this.#records
        .filter((other) => other !== record && other.named && other.directory === record.directory)
        .map((other) => other.fileName.toLowerCase()),
    );
    return uniqueFileName(
      wanted,
      (candidate) =>
        reserved.has(candidate.toLowerCase()) ||
        existsSync(join(record.directory, candidate)) ||
        existsSync(join(record.directory, `${candidate}${PART_SUFFIX}`)),
    );
  }

  async #finish(record: DownloadRecord): Promise<void> {
    const part = partPathOf(record);
    try {
      // Someone may have put a file of this name in the folder while the download ran.
      if (existsSync(join(record.directory, record.fileName))) {
        const free = this.#freeName(record, record.fileName);
        await rename(part, join(record.directory, `${free}${PART_SUFFIX}`));
        record.fileName = free;
      }
      await rename(partPathOf(record), join(record.directory, record.fileName));
    } catch (error) {
      throw new DiskError('The finished file could not be put in place.', { cause: error });
    }
    record.status = DownloadStatus.Completed;
    record.completedAt = new Date(this.#now()).toISOString();
  }
}
