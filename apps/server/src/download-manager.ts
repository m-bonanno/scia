import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { type Download, type Settings, type SettingsPatch, type Snapshot } from '@scia/contracts';
import { DEFAULT_THEME } from '@scia/contracts/theme';
import {
  canPause,
  canResume,
  canStart,
  DownloadFailure,
  DownloadStatus,
  etaSeconds,
  fileKindOfName,
  fileNameFromHost,
  fileNameFromUrl,
  nextToStart,
  PageFailure,
  planSegments,
  sanitizeFileName,
  type Segment,
  SpeedMeter,
  uniqueFileName,
  UnlockFailure,
} from '@scia/core';
import { DownloadTask } from './download-task.ts';
import { HlsTask, piecesOf, type Timeline } from './hls-task.ts';
import type { LinkResolver } from './link-resolver.ts';
import { describeFailure, type Logger } from './logger.ts';
import { chooseMedia, type MediaKind, PageError } from './media-choice.ts';
import { offeredAs } from './offered-links.ts';
import { type MarkDownloaded, markerFor } from './origin-mark.ts';
import type { PageReader } from './page-reader.ts';
import {
  DiskError,
  RemoteError,
  type RemoteFile,
  type RemoteSource,
  type RequestHeaders,
} from './remote-source.ts';
import { ServiceError } from './service-error.ts';
import type { DownloadRecord, StateStore } from './state-store.ts';
import { Throttle } from './throttle.ts';

export const PART_SUFFIX = '.scia';

const DEFAULT_SETTINGS = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  speedLimitBytesPerSecond: null,
  theme: DEFAULT_THEME,
  // The stables only: the betas are for whoever turns them on (the owner, #82).
  betaUpdates: false,
  watchClipboard: false,
} as const;
// A connection is not opened for less than this.
const MIN_SEGMENT_BYTES = 1024 * 1024;
const CHECKPOINT_MS = 5000;
// The name of a page's video whose site does not say what it is called.
const UNTITLED = 'video';
// How long a link copied to the clipboard waits for the service to say whether it is a file
// host's. One it has not said of by then is not taken: no link is offered on a guess.
const OFFER_HOST_LIMIT_MS = 5000;

export const ManagerRefusal = {
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  Invalid: 'INVALID_REQUEST',
} as const;
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
  // What turns a hoster's link into a direct one, through a connected service. Without it
  // every link is fetched as it stands.
  readonly resolver?: LinkResolver;
  // What finds the video a page plays, when a link is a page. Without it every page is fetched
  // as it stands.
  readonly pageReader?: PageReader;
  // What marks a finished file as coming from the network; the running system's by default.
  readonly markDownloaded?: MarkDownloaded;
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
  task: DownloadTask | HlsTask | undefined;
  intent: StopIntent | undefined;
  settled: Promise<void>;
}

// Where a download's bytes are, and how they are asked for.
interface Located {
  readonly url: string;
  readonly headers: RequestHeaders;
  // What the host said of the file; nothing for a stream, whose playlist the task reads.
  readonly remote: RemoteFile | null;
  readonly kind: MediaKind;
}

// The page a link was on is said to the host of that link, never to the host a service sent
// Scia to instead. The video of a page is asked for with the headers its site gave, and those
// only.
function headersOf(record: DownloadRecord): RequestHeaders {
  return record.referrer === null || record.via !== null ? {} : { referer: record.referrer };
}

// The container a named page's video already holds bytes of: what its stored video says, or —
// that refused at load — what its name ends with.
function containerOf(record: DownloadRecord): string {
  return record.video?.media.ext ?? record.fileName.slice(record.fileName.lastIndexOf('.') + 1);
}

interface Progress {
  readonly downloadedBytes: number;
  readonly segments: Segment[];
  readonly timeline: Timeline | null;
  // Of a stream, the bytes of its whole pieces; of a file, its bytes.
  readonly wholeBytes?: number;
}

// A stream's task says nothing until it has read its playlist: the record says what was kept,
// so that the row does not drop to nothing on a resume.
function progressOf(task: DownloadTask | HlsTask | undefined): Progress | undefined {
  if (task === undefined) return undefined;
  if (task instanceof HlsTask) {
    const progress = task.progress();
    return progress.timeline === null ? undefined : { ...progress, segments: [] };
  }
  return { ...task.progress(), timeline: null };
}

// What is left to fetch: of a file's size, or — for a stream, whose size is not known — what the
// pieces already fetched say of the rest, at the same bytes per second of video.
function bytesLeft(
  totalBytes: number | null,
  downloadedBytes: number,
  timeline: Timeline | null,
): number | null {
  if (totalBytes !== null) return totalBytes - downloadedBytes;
  if (timeline === null) return null;
  const doneMs = timeline.segments.reduce((sum, piece) => sum + piece.downloaded, 0);
  if (doneMs === 0) return null;
  return Math.round((downloadedBytes * (timeline.totalMs - doneMs)) / doneMs);
}

// One address however it was written: the case of its scheme and host, an empty path.
function addressOf(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
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
  #busy = false;
  readonly #busyListeners = new Set<(busy: boolean) => void>();
  #checkpoint: ReturnType<typeof setInterval> | undefined;
  #checkpointing = false;
  #closed = false;
  readonly #markDownloaded: MarkDownloaded;
  // One for every connection of every download: the limit is for all of them together.
  readonly #throttle: Throttle;

  constructor(deps: ManagerDeps, records: DownloadRecord[], settings: Settings) {
    this.#deps = deps;
    this.#markDownloaded = deps.markDownloaded ?? markerFor(process.platform);
    this.#records = records;
    this.#settings = settings;
    this.#throttle = new Throttle(settings.speedLimitBytesPerSecond);
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
    return {
      downloads: this.#records.map((record) => this.#view(record)),
      watchClipboard: this.#settings.watchClipboard,
    };
  }

  find(id: string): Download {
    return this.#view(this.#record(id));
  }

  // The version to pass next time. Resolves at once while a download runs (its progress never
  // stops changing), otherwise at the next change — or when `gone` says that whoever asked is
  // no longer there, so that nothing waits here on its behalf.
  nextChange(since: number, gone?: AbortSignal): Promise<number> {
    if (this.#version > since || this.#running.size > 0 || this.#closed || gone?.aborted === true) {
      return Promise.resolve(this.#version);
    }
    return new Promise((resolve) => {
      const wake = () => {
        gone?.removeEventListener('abort', leave);
        resolve(this.#version);
      };
      const leave = () => {
        this.#waiters = this.#waiters.filter((waiter) => waiter !== wake);
        resolve(this.#version);
      };
      this.#waiters.push(wake);
      gone?.addEventListener('abort', leave, { once: true });
    });
  }

  // Whether a download of the person's runs or waits its turn: what the engine's own fetches wait
  // for (docs/adr/0011). A paused or failed download waits for the person, not for the engine.
  isBusy(): boolean {
    return this.#records.some(
      ({ status }) => status === DownloadStatus.Downloading || status === DownloadStatus.Queued,
    );
  }

  // Told each time that changes; answers how to stop being told.
  onBusyChange(listener: (busy: boolean) => void): () => void {
    this.#busy = this.isBusy();
    this.#busyListeners.add(listener);
    return () => {
      this.#busyListeners.delete(listener);
    };
  }

  add(input: {
    readonly urls: readonly string[];
    readonly referrer?: string | undefined;
  }): Download[] {
    const added = input.urls.map((url) =>
      this.#newRecord(url, input.referrer ?? null, DownloadStatus.Queued),
    );
    this.#records.push(...added);
    this.#changed();
    this.#schedule();
    return added.map((record) => this.#view(record));
  }

  // The links main read on the clipboard (#128): those that are files or videos Scia knows are
  // added ready, in the order they were copied, and none starts. A link already in the list —
  // whatever its state — is not added again.
  async offer(urls: readonly string[]): Promise<Download[]> {
    const taken = await Promise.all(
      urls.map(async (url) => ((await this.#isOffered(url)) ? url : undefined)),
    );
    // Read after the wait: another offer may have added some of them meanwhile.
    const known = new Set(this.#records.map((record) => addressOf(record.url)));
    const added: DownloadRecord[] = [];
    for (const url of taken) {
      if (url === undefined || known.has(addressOf(url))) continue;
      known.add(addressOf(url));
      added.push(this.#newRecord(url, null, DownloadStatus.Ready));
    }
    // How many, never which: what a person copies is theirs.
    this.#deps.logger.info('links_offered', { links: urls.length, added: added.length });
    if (added.length > 0) {
      this.#records.push(...added);
      this.#changed();
    }
    return added.map((record) => this.#view(record));
  }

  start(id: string): Download {
    const record = this.#record(id);
    if (!canStart(record.status)) {
      throw new ManagerError(ManagerRefusal.Conflict, 'Only a ready download starts.');
    }
    record.status = DownloadStatus.Queued;
    this.#changed();
    this.#schedule();
    return this.#view(record);
  }

  // Every ready download joins the queue, in its order: the queue's limit still holds.
  startReady(): Download[] {
    const ready = this.#records.filter((record) => canStart(record.status));
    if (ready.length === 0) return [];
    for (const record of ready) record.status = DownloadStatus.Queued;
    this.#changed();
    this.#schedule();
    return ready.map((record) => this.#view(record));
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
    // A link a service or a site gave does not last: after a failure another is asked for.
    if (record.status === DownloadStatus.Failed) {
      record.unlockedUrl = null;
      if (record.video !== null) record.video = { ...record.video, source: null };
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
        // A stream's pieces, kept beside its part file.
        await rm(piecesOf(partPathOf(record)), { recursive: true, force: true });
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
      // Null is a value here: it lifts the limit.
      ...(patch.speedLimitBytesPerSecond === undefined
        ? {}
        : { speedLimitBytesPerSecond: patch.speedLimitBytesPerSecond }),
      ...(patch.theme === undefined ? {} : { theme: patch.theme }),
      ...(patch.betaUpdates === undefined ? {} : { betaUpdates: patch.betaUpdates }),
      ...(patch.watchClipboard === undefined ? {} : { watchClipboard: patch.watchClipboard }),
    };
    // At once, also for what is already running.
    if (patch.speedLimitBytesPerSecond !== undefined) {
      this.#throttle.limit(patch.speedLimitBytesPerSecond);
    }
    this.#changed();
    this.#schedule();
    return this.#settings;
  }

  // Where what is added from now on goes. A download already in the list keeps the folder it
  // was added with. The folder is made if it is not there; one that cannot be made or written
  // to is refused, and the settings do not change.
  //
  // Writing is proven by writing: a file of Scia's own is made in the folder and removed. What
  // the system answers when asked whether a folder is writable is not the truth on Windows,
  // where it says yes for every folder that exists.
  async setDownloadDirectory(directory: string): Promise<Settings> {
    if (!isAbsolute(directory)) {
      throw new ManagerError(ManagerRefusal.Invalid, 'The folder has to be an absolute path.');
    }
    // As the system names it: one folder is one string, however it was written.
    const folder = resolve(directory);
    const probe = join(folder, `.scia-${randomUUID()}${PART_SUFFIX}`);
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(probe, '', { flag: 'wx' });
      await rm(probe);
    } catch {
      throw new ManagerError(ManagerRefusal.Invalid, 'The folder cannot be made or written to.');
    }
    this.#settings = { ...this.#settings, downloadDirectory: folder };
    this.#changed();
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

  #newRecord(url: string, referrer: string | null, status: DownloadStatus): DownloadRecord {
    return {
      id: (this.#deps.newId ?? randomUUID)(),
      url,
      referrer,
      directory: this.#settings.downloadDirectory,
      fileName: fileNameFromUrl(url),
      named: false,
      status,
      totalBytes: null,
      resumable: false,
      validator: null,
      segments: [],
      downloadedBytes: 0,
      failure: null,
      failureStatus: null,
      via: null,
      unlockedUrl: null,
      video: null,
      fromPage: false,
      timeline: null,
      createdAt: new Date(this.#now()).toISOString(),
      completedAt: null,
    };
  }

  // A file by its name, a video's page on a site Scia knows, or a file host's link: the service
  // connected says so, or — none connected — AllDebrid's public list does (docs/adr/0006). What
  // the service cannot say within its limit is left out.
  async #isOffered(url: string): Promise<boolean> {
    if (offeredAs(url) !== undefined) return true;
    const { resolver } = this.#deps;
    if (resolver === undefined) return false;
    try {
      const signal = AbortSignal.timeout(OFFER_HOST_LIMIT_MS);
      return (await resolver.serviceFor(url, signal)) !== undefined;
    } catch (error) {
      return error instanceof ServiceError && error.failure === UnlockFailure.NeedsService;
    }
  }

  #record(id: string): DownloadRecord {
    const record = this.#records.find((candidate) => candidate.id === id);
    if (record === undefined) throw new ManagerError(ManagerRefusal.NotFound, 'No such download.');
    return record;
  }

  #view(record: DownloadRecord): Download {
    const running = this.#running.get(record.id);
    const progress = progressOf(running?.task) ?? record;
    const bytesPerSecond = running?.meter.bytesPerSecond(this.#now()) ?? 0;
    const left = bytesLeft(
      record.totalBytes,
      'wholeBytes' in progress
        ? (progress.wholeBytes ?? progress.downloadedBytes)
        : progress.downloadedBytes,
      progress.timeline,
    );
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
      etaSeconds: left === null || running === undefined ? null : etaSeconds(left, bytesPerSecond),
      resumable: record.resumable,
      segments: progress.segments,
      failure: record.failure,
      failureStatus: record.failureStatus,
      via: record.via,
      media: record.video?.media ?? null,
      timeline: progress.timeline,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
    };
  }

  #changed(): void {
    this.#version += 1;
    for (const wake of this.#waiters.splice(0)) wake();
    const busy = this.isBusy();
    if (busy !== this.#busy) {
      this.#busy = busy;
      for (const listener of this.#busyListeners) listener(busy);
    }
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

  #keepProgress(record: DownloadRecord, task: DownloadTask | HlsTask): void {
    const progress = progressOf(task);
    if (progress === undefined) return;
    record.segments = progress.segments;
    record.downloadedBytes = progress.downloadedBytes;
    record.timeline = progress.timeline;
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
      const { url, headers, remote, kind } = await this.#locate(record, signal);
      // A stream of its own — named, with pieces kept — that a new reading made a file: its pieces
      // are of nothing now. Never another download's: a name not yet final is no one's.
      if (kind === 'file' && record.named && record.timeline !== null) {
        await rm(piecesOf(partPathOf(record)), { recursive: true, force: true }).catch(
          (error: unknown) => {
            throw new DiskError('The pieces of the stream could not be removed.', { cause: error });
          },
        );
        record.timeline = null;
      }
      await mkdir(record.directory, { recursive: true }).catch((error: unknown) => {
        throw new DiskError('The folder could not be made.', { cause: error });
      });
      if (kind === 'hls' || remote === null) {
        await this.#runStream(record, running, url, headers, signal);
        return;
      }
      this.#adopt(record, remote);
      const task = new DownloadTask({
        source: this.#deps.source,
        url,
        headers,
        partPath: partPathOf(record),
        totalBytes: record.totalBytes,
        resumable: record.resumable,
        connections: this.#settings.connectionsPerDownload,
        segments: record.segments,
        onBytes: (count) => {
          running.meter.record(count, this.#now());
        },
        allowance: (expectedBytes) => this.#throttle.allowance(expectedBytes),
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

  // A page's video offered as an HLS stream (docs/adr/0010): named once, of no size known before,
  // made into the part file by its task; its pieces wait beside it, kept across a pause.
  async #runStream(
    record: DownloadRecord,
    running: Running,
    url: string,
    headers: RequestHeaders,
    signal: AbortSignal,
  ): Promise<void> {
    if (!record.named) {
      record.fileName = this.#freeName(record, record.fileName);
      record.named = true;
    }
    record.totalBytes = null;
    record.validator = null;
    record.resumable = true;
    record.segments = [];
    const task = new HlsTask({
      source: this.#deps.source,
      playlistUrl: url,
      headers,
      partPath: partPathOf(record),
      // Pieces of another quality are not pieces of this one.
      variant: String(record.video?.media.height ?? ''),
      connections: this.#settings.connectionsPerDownload,
      onBytes: (count) => {
        running.meter.record(count, this.#now());
      },
      allowance: (expectedBytes) => this.#throttle.allowance(expectedBytes),
      ...(this.#deps.retryDelayMs === undefined ? {} : { retryDelayMs: this.#deps.retryDelayMs }),
    });
    running.task = task;
    this.#changed();
    await task.run(signal);
    this.#keepProgress(record, task);
    // The mp4's own size: not the pieces', which MPEG-TS weighs more and fMP4 less, its init
    // segment uncounted.
    record.totalBytes = await stat(partPathOf(record)).then(
      (made) => made.size,
      (error: unknown) => {
        throw new DiskError('The made file could not be read.', { cause: error });
      },
    );
    record.downloadedBytes = record.totalBytes;
    await this.#finish(record);
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
        error instanceof RemoteError || error instanceof ServiceError || error instanceof PageError
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

  // Where the bytes are, and how they are asked for. A link whose host answers a web page, of a
  // site the page reader knows, is the video the page plays (docs/adr/0009). The page is read
  // when the download first starts; the video it chose is used again after a pause or a
  // restart, and the page is read again after a failure, as a service's link is asked for
  // again. A link that went through a service is not read: the service said what it is.
  async #locate(record: DownloadRecord, signal: AbortSignal): Promise<Located> {
    if (record.video !== null || record.fromPage) return this.#locateVideo(record, signal);
    const url = await this.#address(record, signal);
    const headers = headersOf(record);
    const remote = await this.#deps.source.probe(url, headers, signal);
    const asItStands = { url, headers, remote, kind: 'file' } as const;
    if (!remote.isPage || record.named || record.via !== null) return asItStands;
    const chosen = await this.#readPage(record, signal);
    if (chosen === undefined) return asItStands;
    return this.#locateVideo(record, signal);
  }

  async #locateVideo(record: DownloadRecord, signal: AbortSignal): Promise<Located> {
    const chosen = record.video?.source ?? (await this.#readPage(record, signal));
    if (chosen === undefined) {
      throw new PageError(PageFailure.Unreadable, 'The page no longer says what video it plays.');
    }
    // A stream is not probed: its task reads its playlist.
    if (chosen.kind === 'hls') {
      return { url: chosen.url, headers: chosen.headers, remote: null, kind: 'hls' };
    }
    const remote = await this.#deps.source.probe(chosen.url, chosen.headers, signal);
    return { url: chosen.url, headers: chosen.headers, remote, kind: 'file' };
  }

  // The video the page plays, into the record: undefined when there is no reader, or when the
  // page is not of a site it knows or plays no video. A video it finds and Scia cannot fetch is a
  // PageError. Read again for a download whose name is final, it keeps the container that name
  // carries: its part file holds that container's bytes.
  async #readPage(
    record: DownloadRecord,
    signal: AbortSignal,
  ): Promise<
    { readonly url: string; readonly headers: RequestHeaders; readonly kind: MediaKind } | undefined
  > {
    const reader = this.#deps.pageReader;
    if (reader === undefined) return undefined;
    const found = await reader.read(record.url, signal);
    if (found === undefined) return undefined;
    const chosen = chooseMedia(found.formats, record.named ? containerOf(record) : undefined);
    const source = { url: chosen.url, headers: { ...chosen.headers }, kind: chosen.kind };
    record.video = { media: chosen.info, source };
    record.fromPage = true;
    // What the site calls the video is a title, not a path: a slash in it is a character.
    if (!record.named) {
      const title = found.title?.trim();
      const stem = title === undefined || title === '' ? UNTITLED : title;
      record.fileName = sanitizeFileName(`${stem}.${chosen.info.ext}`);
    }
    this.#changed();
    return source;
  }

  // Where the bytes are: at the link itself, or — for a link a connected service takes — at
  // the direct link the service gives for it. The service is asked once: its link is kept, and
  // used again after a pause or a restart. The link that was added stays what the download
  // is known by; the one the service gave is never shown and never logged.
  async #address(record: DownloadRecord, signal: AbortSignal): Promise<string> {
    const { resolver } = this.#deps;
    if (resolver === undefined) return record.url;
    if (record.unlockedUrl !== null) return record.unlockedUrl;
    // A link that was a service's stays that service's: it is never fetched as it stands.
    const service = record.via ?? (await resolver.serviceFor(record.url, signal));
    if (service === undefined) return record.url;
    if (record.via === null) {
      record.via = service;
      this.#changed();
    }
    const unlocked = await resolver.unlock(service, record.url, signal);
    record.unlockedUrl = unlocked.url;
    // The host of the direct link names the file when it does (#adopt); the service's name
    // is the one to fall back on, and is a name from a host like any other.
    const named = unlocked.fileName === undefined ? undefined : fileNameFromHost(unlocked.fileName);
    if (!record.named && named !== undefined) record.fileName = named;
    return unlocked.url;
  }

  // What the host says of the file, into the record: its name the first time, its size, whether
  // a pause keeps the bytes. A file that changed since the last attempt starts again.
  #adopt(record: DownloadRecord, remote: RemoteFile): void {
    if (!record.named) {
      // A page's video is named after what its site calls it, not after its server's file.
      const wanted = record.video === null ? (remote.fileName ?? record.fileName) : record.fileName;
      record.fileName = this.#freeName(record, wanted);
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
    // Before the name is looked at: nothing waits between "is it free?" and the rename.
    await this.#mark(record);
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

  // Marked while it is still the part file, so that the file never stands under its name
  // without its mark. A disk without streams (FAT, some shares) refuses: the file is whole all
  // the same, and the log says the mark is missing.
  async #mark(record: DownloadRecord): Promise<void> {
    try {
      await this.#markDownloaded(partPathOf(record));
    } catch (error) {
      this.#deps.logger.warn('mark_refused', { id: record.id, error: describeFailure(error) });
    }
  }
}
