import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  type AccountMagnet,
  type Download,
  IntegrationId,
  type Magnet,
  type Settings,
  type SettingsPatch,
  type Snapshot,
} from '@scia/contracts';
import { DEFAULT_THEME } from '@scia/contracts/theme';
import {
  AlbumFailure,
  canPause,
  canResume,
  canStart,
  DownloadFailure,
  DownloadStatus,
  etaSeconds,
  FALLBACK_FILE_NAME,
  fileKindOfName,
  fileNameFromHost,
  fileNameFromUrl,
  hashOfMagnet,
  magnetFolders,
  MagnetStage,
  MagnetStatus,
  nextToStart,
  PageFailure,
  planSegments,
  sanitizeFileName,
  type Segment,
  SpeedMeter,
  isNameTaken,
  uniqueFileName,
  UnlockFailure,
} from '@scia/core';
import type { Bunkr } from './bunkr.ts';
import { isMaintenance } from './bunkr-pages.ts';
import { DownloadTask } from './download-task.ts';
import { HlsTask, piecesOf, type Timeline } from './hls-task.ts';
import type { LinkResolver } from './link-resolver.ts';
import { describeFailure, type Logger } from './logger.ts';
import type { MagnetFile, MagnetService } from './magnet-service.ts';
import { MagnetWatch, nameOfMagnet } from './magnet-watch.ts';
import { chooseMedia, type MediaKind, type MediaSource, PageError } from './media-choice.ts';
import { PairTask, pictureOf, soundOf } from './pair-task.ts';
import { offeredAs } from './offered-links.ts';
import { type MarkDownloaded, markerFor } from './origin-mark.ts';
import { type MarkSparse, sparseMarkerFor } from './sparse-file.ts';
import type { PageReader } from './page-reader.ts';
import {
  DiskError,
  RemoteError,
  type RemoteFile,
  type RemoteSource,
  type RequestHeaders,
} from './remote-source.ts';
import { ServiceError } from './service-error.ts';
import type { DownloadRecord, MagnetRecord, StateStore } from './state-store.ts';
import { Throttle } from './throttle.ts';

export const PART_SUFFIX = '.scia';
// What a download keeps beside its name while it runs: its part file, a stream's pieces, and a
// pair's picture and sound.
const WORKING_SUFFIXES = [
  PART_SUFFIX,
  piecesOf(PART_SUFFIX),
  pictureOf(PART_SUFFIX),
  soundOf(PART_SUFFIX),
] as const;

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
// What the host of a direct link a service gave answers once the link has expired (#180).
// AllDebrid's documentation does not say how long a link lasts, nor how it answers after, and
// names no code of its own for it.
const EXPIRED = new Set([403, 410]);

// A web page where the file of a service's direct link was (docs/adr/0022). Its failure is the
// one of a host that refuses the link, with no status: the row says the link the service gave
// no longer works, and that "Retry" asks for a new one.
class NotTheFile extends RemoteError {
  constructor() {
    super(DownloadFailure.HttpStatus, false, 'The link the service gave answered a web page.');
  }
}

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
  // What fetches a pasted magnet, through a connected service (#137). Without it every magnet
  // says that it needs one.
  readonly magnets?: MagnetService;
  readonly magnetPollMs?: number;
  // What finds the video a page plays, when a link is a page. Without it every page is fetched
  // as it stands.
  readonly pageReader?: PageReader;
  // What reads Bunkr's albums and its files' pages (docs/adr/0024). Without it, their links are
  // fetched as they stand.
  readonly bunkr?: Bunkr;
  // What marks a finished file as coming from the network; the running system's by default.
  readonly markDownloaded?: MarkDownloaded;
  // What makes a new part file sparse; the running system's by default.
  readonly markSparse?: MarkSparse;
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
  task: DownloadTask | HlsTask | PairTask | undefined;
  intent: StopIntent | undefined;
  settled: Promise<void>;
}

// What was chosen of a page's video, as the record keeps it.
type VideoSource = NonNullable<NonNullable<DownloadRecord['video']>['source']>;

// Where a download's bytes are, and how they are asked for.
interface Located {
  readonly url: string;
  readonly headers: RequestHeaders;
  // What the host said of the file; nothing for a stream, whose playlist the task reads.
  readonly remote: RemoteFile | null;
  readonly kind: MediaKind;
  // Of a pair (docs/adr/0021): where its sound is, and what its host said of it. The rest is the
  // picture's.
  readonly sound?: MediaSource & { readonly remote: RemoteFile };
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
function progressOf(task: DownloadTask | HlsTask | PairTask | undefined): Progress | undefined {
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

// Something that is not a folder stands at this path.
function isFileThere(path: string): boolean {
  try {
    return !statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// The host's file is not the one the record's bytes are of: another size, or another validator
// where both answers carry one.
function isAnotherFile(record: DownloadRecord, remote: RemoteFile): boolean {
  return (
    record.totalBytes !== remote.totalBytes ||
    (record.validator !== null &&
      remote.validator !== null &&
      record.validator !== remote.validator)
  );
}

// A refusal from the address a site gave a file at this run (docs/adr/0024): the row says that
// address stopped working, not the link the person pasted, and that a retry asks for a new one.
// Only a refusal that cannot heal, a 4xx: a busy server (5xx, 429, 408, 425, a 204) is no dead
// link, and keeps the sentence of a busy server, as does a host that ignored a range (a 200).
function ofTheSitesLink(error: unknown): unknown {
  if (
    !(error instanceof RemoteError) ||
    error.failure !== DownloadFailure.HttpStatus ||
    error.retryable ||
    error.status === null ||
    error.status < 400 ||
    error.status >= 500
  ) {
    return error;
  }
  return new RemoteError(
    AlbumFailure.LinkFailed,
    false,
    'The link the site gave no longer works.',
    {
      cause: error,
      status: error.status,
    },
  );
}

function partPathOf(record: DownloadRecord): string {
  return join(record.directory, `${record.fileName}${PART_SUFFIX}`);
}

// The queue, the names, the state on disk. What a single download does on the network and the
// disk is DownloadTask's.
export class DownloadManager {
  readonly #deps: ManagerDeps;
  readonly #records: DownloadRecord[];
  // The magnets the service is fetching, or could not: theirs is the list's top (#137).
  #magnets: MagnetRecord[];
  readonly #magnetWatch: MagnetWatch;
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
  readonly #markSparse: MarkSparse;
  // One for every connection of every download: the limit is for all of them together.
  readonly #throttle: Throttle;

  constructor(
    deps: ManagerDeps,
    records: DownloadRecord[],
    settings: Settings,
    magnets: MagnetRecord[] = [],
  ) {
    this.#deps = deps;
    this.#markDownloaded = deps.markDownloaded ?? markerFor(process.platform);
    this.#markSparse = deps.markSparse ?? sparseMarkerFor(process.platform);
    this.#records = records;
    this.#magnets = magnets;
    this.#magnetWatch = new MagnetWatch({
      service: deps.magnets,
      logger: deps.logger,
      ...(deps.magnetPollMs === undefined ? {} : { pollMs: deps.magnetPollMs }),
      records: () => this.#magnets,
      changed: () => {
        this.#changed();
      },
      ready: (record, files) => {
        this.#magnetReady(record, files);
      },
      same: (record) => {
        this.#magnets = this.#magnets.filter((other) => other !== record);
      },
    });
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
    const manager = new DownloadManager(deps, records, settings, state?.magnets ?? []);
    manager.#schedule();
    // A magnet waited for when the engine stopped is waited for again, never sent again.
    manager.#magnetWatch.wake();
    return manager;
  }

  snapshot(): Snapshot {
    return {
      downloads: this.#records.map((record) => this.#view(record)),
      magnets: this.#magnets.map((record) => this.#magnetView(record)),
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
  // for (docs/adr/0011). A paused, failed or ready download waits for the person, not for the engine.
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

  // Magnets pasted into the page, for the service to fetch (#137): one already in the list —
  // the same torrent, however it was written — is not added again.
  addMagnets(magnets: readonly string[]): Magnet[] {
    const known = new Set(
      this.#magnets.flatMap((record) =>
        record.magnet === null ? [] : [hashOfMagnet(record.magnet)],
      ),
    );
    const added: MagnetRecord[] = [];
    for (const magnet of magnets) {
      const hash = hashOfMagnet(magnet);
      if (known.has(hash)) continue;
      known.add(hash);
      added.push({
        id: (this.#deps.newId ?? randomUUID)(),
        magnet,
        name: nameOfMagnet(magnet),
        serviceId: null,
        status: MagnetStatus.Sending,
        totalBytes: null,
        downloadedBytes: 0,
        failure: null,
        directory: this.#settings.downloadDirectory,
        createdAt: new Date(this.#now()).toISOString(),
      });
    }
    // How many, never which: a magnet names a person's torrent.
    this.#deps.logger.info('magnets_added', { magnets: magnets.length, added: added.length });
    if (added.length > 0) {
      this.#magnets.push(...added);
      this.#changed();
      this.#magnetWatch.wake();
    }
    return added.map((record) => this.#magnetView(record));
  }

  // Scia stops waiting for it; the service keeps it, as anything the account added elsewhere.
  removeMagnet(id: string): void {
    const record = this.#magnetRecord(id);
    this.#magnets = this.#magnets.filter((other) => other !== record);
    this.#magnetWatch.forget(id);
    this.#changed();
  }

  // The magnets main read on the clipboard (#139; docs/adr/0017): sent at once, as pasted ones
  // are, while a service is connected; with none, left out — a copy is not a request to connect.
  offerMagnets(magnets: readonly string[]): Magnet[] {
    if (this.#deps.magnets?.hasService() !== true) {
      this.#deps.logger.info('clipboard_magnets_left_out', { magnets: magnets.length });
      return [];
    }
    return this.addMagnets(magnets);
  }

  // A magnet that failed is sent again: the service answers for the same torrent what it has.
  retryMagnet(id: string): Magnet {
    const record = this.#magnetRecord(id);
    if (record.status !== MagnetStatus.Failed) {
      throw new ManagerError(ManagerRefusal.Conflict, 'Only a magnet that failed is tried again.');
    }
    // One taken from the account has nothing to send: the service is asked about it again.
    if (record.magnet === null) {
      record.status = MagnetStatus.Fetching;
    } else {
      record.status = MagnetStatus.Sending;
      record.serviceId = null;
    }
    record.failure = null;
    this.#changed();
    this.#magnetWatch.wake();
    return this.#magnetView(record);
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
        // A stream's pieces, and a pair's picture and sound, kept beside its part file.
        await rm(piecesOf(partPathOf(record)), { recursive: true, force: true });
        await this.#removePair(record);
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

  // The magnets of the connected service's account, as it lists them (#138; docs/adr/0016): also
  // those added on its site or by other applications. Asked only while the page shows them.
  async accountMagnets(): Promise<AccountMagnet[]> {
    const states = await this.#magnetService().states();
    const inScia = new Set(this.#magnets.map((record) => record.serviceId));
    return states.flatMap((state) =>
      state.stage === 'unreadable'
        ? []
        : [
            {
              id: state.id,
              name: state.name,
              stage: state.stage,
              totalBytes: state.size > 0 ? state.size : null,
              downloadedBytes: state.downloaded,
              bytesPerSecond: state.bytesPerSecond,
              addedAt: state.addedAt === null ? null : new Date(state.addedAt * 1000).toISOString(),
              inScia: inScia.has(state.id),
            },
          ],
    );
  }

  // A ready magnet of the account, made a magnet of Scia's list: its files become downloads in
  // its folder, as a pasted one's do. The service has it: nothing is sent.
  async addAccountMagnet(serviceId: number): Promise<Magnet> {
    const state = (await this.#magnetService().states()).find((each) => each.id === serviceId);
    if (state === undefined || state.stage === 'unreadable') {
      throw new ManagerError(ManagerRefusal.NotFound, 'The account has no such magnet.');
    }
    if (state.stage !== MagnetStage.Ready) {
      throw new ManagerError(
        ManagerRefusal.Conflict,
        'Only a ready magnet of the account is taken.',
      );
    }
    // Checked after the service answered: two asks at once take it once.
    if (this.#magnets.some((record) => record.serviceId === serviceId)) {
      throw new ManagerError(ManagerRefusal.Conflict, 'This magnet is already in the list.');
    }
    const record: MagnetRecord = {
      id: (this.#deps.newId ?? randomUUID)(),
      magnet: null,
      name: state.name,
      serviceId,
      status: MagnetStatus.Fetching,
      totalBytes: state.size > 0 ? state.size : null,
      downloadedBytes: state.downloaded,
      failure: null,
      directory: this.#settings.downloadDirectory,
      createdAt: new Date(this.#now()).toISOString(),
    };
    this.#magnets.push(record);
    this.#deps.logger.info('account_magnet_added');
    this.#changed();
    this.#magnetWatch.wake();
    return this.#magnetView(record);
  }

  #magnetService(): MagnetService {
    if (this.#deps.magnets === undefined) {
      throw new ServiceError(IntegrationId.AllDebrid, UnlockFailure.NeedsService, 'No service.');
    }
    return this.#deps.magnets;
  }

  #magnetRecord(id: string): MagnetRecord {
    const record = this.#magnets.find((candidate) => candidate.id === id);
    if (record === undefined) throw new ManagerError(ManagerRefusal.NotFound, 'No such magnet.');
    return record;
  }

  #magnetView(record: MagnetRecord): Magnet {
    return {
      id: record.id,
      name: record.name,
      status: record.status,
      totalBytes: record.totalBytes,
      downloadedBytes: record.downloadedBytes,
      // Known of a magnet the service is fetching only: one that failed or is sent has none.
      bytesPerSecond: this.#magnetWatch.bytesPerSecond(record.id),
      failure: record.failure,
      createdAt: record.createdAt,
    };
  }

  // Its files become downloads through the service — each in the magnet's folder and the folders
  // the magnet puts it in, under the name the magnet gives it — and the magnet leaves the list.
  #magnetReady(record: MagnetRecord, files: readonly MagnetFile[]): void {
    this.#magnets = this.#magnets.filter((other) => other !== record);
    // Its folder, or the first free one beside it when a file of its name stands there: a folder of
    // that name is the magnet's to share, as its files take free names inside it.
    const [own = FALLBACK_FILE_NAME] = magnetFolders(record.name, []);
    const root = uniqueFileName(own, (candidate) => isFileThere(join(record.directory, candidate)));
    const added = files.map((file) => {
      const download = this.#newRecord(file.link, null, DownloadStatus.Queued);
      download.via = IntegrationId.AllDebrid;
      const [, ...folders] = magnetFolders(record.name, file.folders);
      download.directory = join(record.directory, root, ...folders);
      download.fileName = fileNameFromHost(file.name) ?? FALLBACK_FILE_NAME;
      download.nameKept = true;
      return download;
    });
    this.#records.push(...added);
    this.#deps.logger.info('magnet_ready', { files: added.length });
    this.#changed();
    this.#schedule();
  }

  // Stops every transfer and writes the state. What was running goes on at the next start.
  async close(): Promise<void> {
    await this.#magnetWatch.close();
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
      nameKept: false,
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
        magnets: this.#magnets,
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

  #keepProgress(record: DownloadRecord, task: DownloadTask | HlsTask | PairTask): void {
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
    const kept = record.unlockedUrl;
    try {
      const { bunkr } = this.#deps;
      if (bunkr?.isAlbum(record.url) === true) {
        await this.#openAlbum(record, bunkr, signal);
        return;
      }
      const located = await this.#locate(record, signal);
      const { url, headers, remote, kind } = located;
      // A stream of its own — named, with pieces kept — that a new reading made a file or a pair:
      // its pieces are of nothing now. Never another download's: a name not yet final is no one's.
      if (kind !== 'hls' && record.named && record.timeline !== null) {
        await rm(piecesOf(partPathOf(record)), { recursive: true, force: true }).catch(
          (error: unknown) => {
            throw new DiskError('The pieces of the stream could not be removed.', { cause: error });
          },
        );
        record.timeline = null;
      }
      // So are the picture and the sound of a pair that a new reading made something else: a
      // page's video only, the one kind of download that is ever a pair.
      if (kind !== 'pair' && record.named && record.fromPage) await this.#removePair(record);
      await mkdir(record.directory, { recursive: true }).catch((error: unknown) => {
        throw new DiskError('The folder could not be made.', { cause: error });
      });
      if (kind === 'hls' || remote === null) {
        await this.#runStream(record, running, url, headers, signal);
        return;
      }
      if (located.sound !== undefined) {
        await this.#runPair(record, running, { url, headers, remote }, located.sound, signal);
        return;
      }
      this.#adopt(record, remote);
      const givenAgain = kept !== null && record.unlockedUrl !== kept;
      const fromSite = bunkr?.isFile(record.url) === true;
      await this.#runFile(record, running, url, headers, givenAgain, signal).catch(
        (error: unknown) => {
          throw fromSite ? ofTheSitesLink(error) : error;
        },
      );
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

  // An album read (docs/adr/0024): it leaves the list, and its files take its place, each a
  // download of its own page, in a folder named after the album — the first free name beside it
  // when a file stands under that name; a folder of that name is shared, as its files take free
  // names inside it, a magnet's rule. Each is named as the album names it, a name from a host.
  async #openAlbum(record: DownloadRecord, bunkr: Bunkr, signal: AbortSignal): Promise<void> {
    // A pause, a removal or a shutdown while the page is read ends the read: nothing is added.
    const album = await bunkr.readAlbum(record.url, signal);
    const folder = uniqueFileName(sanitizeFileName(album.name), (candidate) =>
      isFileThere(join(record.directory, candidate)),
    );
    const files = album.files.map((file) => {
      const download = this.#newRecord(file.url, null, DownloadStatus.Queued);
      download.directory = join(record.directory, folder);
      const named = file.name === undefined ? undefined : fileNameFromHost(file.name);
      if (named !== undefined) {
        download.fileName = named;
        download.nameKept = true;
      }
      return download;
    });
    this.#records.splice(this.#records.indexOf(record), 1, ...files);
    // How many, never which: an album is a person's.
    this.#deps.logger.info('album_read', { files: files.length });
  }

  // A file's bytes, from those already on the disk. A direct link a service gave that expires on
  // the way is asked for again, and the download goes on from its bytes on the new one — or from
  // the first byte, if the new link is another file or its host serves no ranges (#adopt). Only
  // for a link that brought bytes the download keeps: one that expires before its first byte, or
  // a link given again on which the download started from the first byte, fails the download, as
  // each request to the service can count against what the account is allowed of a host
  // (docs/adr/0022). `givenAgain`: the link was given again in this run, at its first probe.
  async #runFile(
    record: DownloadRecord,
    running: Running,
    url: string,
    headers: RequestHeaders,
    givenAgain: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    let last = givenAgain && record.downloadedBytes === 0;
    for (let link = url; ;) {
      let brought = 0;
      const task = new DownloadTask({
        source: this.#deps.source,
        url: link,
        headers,
        partPath: partPathOf(record),
        totalBytes: record.totalBytes,
        resumable: record.resumable,
        connections: this.#settings.connectionsPerDownload,
        segments: record.segments,
        onBytes: (count) => {
          brought += count;
          running.meter.record(count, this.#now());
        },
        allowance: (expectedBytes) => this.#throttle.allowance(expectedBytes),
        markSparse: this.#sparseFor(record),
        ...(this.#deps.retryDelayMs === undefined ? {} : { retryDelayMs: this.#deps.retryDelayMs }),
      });
      running.task = task;
      this.#changed();
      try {
        await task.run(signal);
        this.#keepProgress(record, task);
        return;
      } catch (error) {
        // A pause that lands between the refusal and here: the service is not asked while the
        // download stops.
        if (last || brought === 0 || signal.aborted || !this.#expired(record, error)) throw error;
        this.#keepProgress(record, task);
      }
      link = await this.#unlockAgain(record, signal);
      this.#adopt(record, await this.#probe(record, link, headers, signal));
      last = record.downloadedBytes === 0;
    }
  }

  // What the host of a link says of its file. A web page from a service's direct link, while the
  // download keeps bytes of another file, is not the file: most likely what is answered for a
  // link that has expired, and never saved over the bytes. A page that is the file those bytes
  // are of — a host that labels the file a page — goes on, and so does a page with no bytes kept:
  // the file the service unlocked may be one.
  async #probe(
    record: DownloadRecord,
    url: string,
    headers: RequestHeaders,
    signal: AbortSignal,
  ): Promise<RemoteFile> {
    const remote = await this.#deps.source.probe(url, headers, signal);
    if (
      record.via !== null &&
      remote.isPage &&
      record.downloadedBytes > 0 &&
      isAnotherFile(record, remote)
    ) {
      throw new NotTheFile();
    }
    return remote;
  }

  // The host of a direct link a service gave says the link has expired.
  #expired(record: DownloadRecord, error: unknown): boolean {
    return (
      this.#deps.resolver !== undefined &&
      record.via !== null &&
      record.unlockedUrl !== null &&
      (error instanceof NotTheFile ||
        (error instanceof RemoteError && error.status !== null && EXPIRED.has(error.status)))
    );
  }

  async #unlockAgain(record: DownloadRecord, signal: AbortSignal): Promise<string> {
    record.unlockedUrl = null;
    this.#deps.logger.info('link_unlocked_again', { id: record.id });
    return this.#address(record, signal);
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

  // A page's picture and its sound offered apart (docs/adr/0021): both fetched, on one line of
  // segments — the picture's bytes, then the sound's — into files beside the part file, then
  // joined into the part file as one mp4 by its task.
  async #runPair(
    record: DownloadRecord,
    running: Running,
    picture: MediaSource & { readonly remote: RemoteFile },
    sound: MediaSource & { readonly remote: RemoteFile },
    signal: AbortSignal,
  ): Promise<void> {
    const ranged = (remote: RemoteFile) => remote.acceptsRanges && remote.totalBytes !== null;
    // Both on one line, as one file of both sizes would be: what the row shows, and what a pause
    // keeps.
    this.#adopt(record, {
      totalBytes:
        picture.remote.totalBytes === null || sound.remote.totalBytes === null
          ? null
          : picture.remote.totalBytes + sound.remote.totalBytes,
      acceptsRanges: ranged(picture.remote) && ranged(sound.remote),
      fileName: undefined,
      validator:
        picture.remote.validator === null && sound.remote.validator === null
          ? null
          : `${picture.remote.validator ?? ''} ${sound.remote.validator ?? ''}`,
      isPage: false,
    });
    const fileOf = (part: MediaSource & { readonly remote: RemoteFile }) => ({
      url: part.url,
      headers: part.headers,
      totalBytes: part.remote.totalBytes,
      resumable: record.resumable,
    });
    const task = new PairTask({
      source: this.#deps.source,
      picture: fileOf(picture),
      sound: fileOf(sound),
      partPath: partPathOf(record),
      connections: this.#settings.connectionsPerDownload,
      segments: record.segments,
      onBytes: (count) => {
        running.meter.record(count, this.#now());
      },
      allowance: (expectedBytes) => this.#throttle.allowance(expectedBytes),
      markSparse: this.#sparseFor(record),
      ...(this.#deps.retryDelayMs === undefined ? {} : { retryDelayMs: this.#deps.retryDelayMs }),
    });
    running.task = task;
    this.#changed();
    await task.run(signal);
    this.#keepProgress(record, task);
    // The mp4's own size: its movie is made anew, beside the bytes of both.
    record.totalBytes = await stat(partPathOf(record)).then(
      (made) => made.size,
      (error: unknown) => {
        throw new DiskError('The made file could not be read.', { cause: error });
      },
    );
    record.downloadedBytes = record.totalBytes;
    record.segments = [];
    await this.#finish(record);
  }

  // The picture and the sound of a pair, kept beside its part file.
  async #removePair(record: DownloadRecord): Promise<void> {
    try {
      await rm(pictureOf(partPathOf(record)), { force: true });
      await rm(soundOf(partPathOf(record)), { force: true });
    } catch (error) {
      throw new DiskError('The picture and the sound could not be removed.', { cause: error });
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
    const { bunkr } = this.#deps;
    if (bunkr?.isFile(record.url) === true) return this.#locateBunkrFile(record, bunkr, signal);
    const kept = record.unlockedUrl;
    let url = await this.#address(record, signal);
    const headers = headersOf(record);
    let remote: RemoteFile;
    try {
      remote = await this.#probe(record, url, headers, signal);
    } catch (error) {
      // A direct link kept from before — a pause, a restart — that expired meanwhile. One the
      // service has just given has brought nothing: it is not asked for again.
      if (url !== kept || !this.#expired(record, error)) throw error;
      url = await this.#unlockAgain(record, signal);
      remote = await this.#probe(record, url, headers, signal);
    }
    const asItStands = { url, headers, remote, kind: 'file' } as const;
    if (!remote.isPage || record.named || record.via !== null) return asItStands;
    const chosen = await this.#readPage(record, signal);
    if (chosen === undefined) return asItStands;
    return this.#locateVideo(record, signal);
  }

  // A file of Bunkr (docs/adr/0024): its page and Bunkr's API are asked at every run for its
  // link, which is kept nowhere, and no service is asked about it. A file pasted by itself is
  // named after its page. What its link lands on is the file, or the run fails: a file server
  // in maintenance answers a video that says so, and a web page is never saved as the file.
  async #locateBunkrFile(
    record: DownloadRecord,
    bunkr: Bunkr,
    signal: AbortSignal,
  ): Promise<Located> {
    const found = await bunkr.locateFile(record.url, signal);
    const named = found.name === undefined ? undefined : fileNameFromHost(found.name);
    if (!record.named && !record.nameKept && named !== undefined) {
      record.fileName = named;
      record.nameKept = true;
    }
    const remote = await this.#deps.source
      .probe(found.url, found.headers, signal)
      .catch((error: unknown) => {
        throw ofTheSitesLink(error);
      });
    if (isMaintenance(remote.fileName)) {
      throw new RemoteError(PageFailure.SiteBusy, false, 'The file server is in maintenance.');
    }
    if (remote.isPage) {
      throw new RemoteError(AlbumFailure.LinkFailed, false, 'The link answered a web page.');
    }
    return { url: found.url, headers: found.headers, remote, kind: 'file' };
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
    if (chosen.kind === 'pair' && chosen.sound !== null) {
      const { sound } = chosen;
      return {
        url: chosen.url,
        headers: chosen.headers,
        remote,
        kind: 'pair',
        sound: {
          ...sound,
          remote: await this.#deps.source.probe(sound.url, sound.headers, signal),
        },
      };
    }
    return { url: chosen.url, headers: chosen.headers, remote, kind: 'file' };
  }

  // The video the page plays, into the record: undefined when there is no reader, or when the
  // page is not of a site it knows or plays no video. A video it finds and Scia cannot fetch is a
  // PageError. Read again for a download whose name is final, it keeps the container that name
  // carries: its part file holds that container's bytes.
  async #readPage(record: DownloadRecord, signal: AbortSignal): Promise<VideoSource | undefined> {
    const reader = this.#deps.pageReader;
    if (reader === undefined) return undefined;
    const found = await reader.read(record.url, signal);
    if (found === undefined) return undefined;
    const chosen = chooseMedia(found.formats, record.named ? containerOf(record) : undefined);
    const source: VideoSource = {
      url: chosen.url,
      headers: { ...chosen.headers },
      kind: chosen.kind,
      sound:
        chosen.sound === undefined
          ? null
          : { url: chosen.sound.url, headers: { ...chosen.sound.headers } },
    };
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
  // used again after a pause or a restart, until it expires (#runFile). The link that was added
  // stays what the download is known by; the one the service gave is never shown and never logged.
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
    if (!record.named && !record.nameKept && named !== undefined) record.fileName = named;
    return unlocked.url;
  }

  // What the host says of the file, into the record: its name the first time, its size, whether
  // a pause keeps the bytes. A file that changed since the last attempt starts again.
  #adopt(record: DownloadRecord, remote: RemoteFile): void {
    if (!record.named) {
      // A page's video is named after what its site calls it, not after its server's file.
      const wanted =
        record.video === null && !record.nameKept
          ? (remote.fileName ?? record.fileName)
          : record.fileName;
      record.fileName = this.#freeName(record, wanted);
      record.named = true;
    }
    const changed = isAnotherFile(record, remote);
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
    const used = {
      inList: reserved,
      onDisk: (name: string) => existsSync(join(record.directory, name)),
    };
    return uniqueFileName(wanted, (candidate) => isNameTaken(candidate, used, WORKING_SUFFIXES));
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

  // A part file that cannot be made sparse is downloaded into as it is, dense: slower to start
  // on NTFS, whole all the same (docs/adr/0026). The log says so.
  #sparseFor(record: DownloadRecord): MarkSparse {
    return async (path) => {
      try {
        await this.#markSparse(path);
      } catch (error) {
        this.#deps.logger.warn('part_file_not_sparse', {
          id: record.id,
          error: describeFailure(error),
        });
      }
    };
  }
}
