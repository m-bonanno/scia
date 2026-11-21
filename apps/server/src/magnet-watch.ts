import {
  hashOfMagnet,
  isServiceFailure,
  MagnetFailure,
  MagnetStatus,
  ServiceFailure,
  UnlockFailure,
} from '@scia/core';
import { describeFailure, type Logger } from './logger.ts';
import type { MagnetFile, MagnetService } from './magnet-service.ts';
import { ServiceError } from './service-error.ts';
import type { MagnetRecord } from './state-store.ts';

// How often the service is asked where the magnets are: one question for all of them. AllDebrid
// allows 12 a second; its own page of magnets asks every few seconds.
export const MAGNET_POLL_MS = 5000;

export interface MagnetWatchDeps {
  // Undefined: no service can fetch a magnet, and every one says so.
  readonly service: MagnetService | undefined;
  readonly logger: Logger;
  readonly pollMs?: number;
  // The manager's own list, read at every turn: a magnet removed meanwhile is nobody's.
  readonly records: () => readonly MagnetRecord[];
  readonly changed: () => void;
  // A magnet whose files are ready: the manager makes them downloads, and lets the magnet go.
  readonly ready: (record: MagnetRecord, files: readonly MagnetFile[]) => void;
}

// What a failure of the service means for a magnet: a failure of its own, or undefined for a
// service that cannot be asked right now — asked again at the next turn.
function failureOf(error: unknown): MagnetFailure | undefined {
  if (!(error instanceof ServiceError)) return MagnetFailure.Unavailable;
  if (error.failure === ServiceFailure.Unavailable) return undefined;
  if (isServiceFailure(error.failure)) return error.failure;
  if (error.failure === UnlockFailure.NotPremium) return MagnetFailure.NotPremium;
  if (error.failure === UnlockFailure.NeedsService) return MagnetFailure.NeedsService;
  return MagnetFailure.Unavailable;
}

function isWaiting(record: MagnetRecord): boolean {
  return record.status === MagnetStatus.Sending || record.status === MagnetStatus.Fetching;
}

// The magnets the service is fetching, watched at one pace (#137; docs/adr/0014): sent when they
// are pasted, asked about all together while any waits, made downloads when ready. Nothing is
// asked while none waits, and nothing at all once closed.
export class MagnetWatch {
  readonly #deps: MagnetWatchDeps;
  // How fast the service fetches each, by Scia's id: of this run only.
  readonly #speeds = new Map<string, number>();
  readonly #stop = new AbortController();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #turn: Promise<void> | undefined;
  // A magnet was pasted while a turn ran.
  #again = false;

  constructor(deps: MagnetWatchDeps) {
    this.#deps = deps;
  }

  bytesPerSecond(id: string): number {
    return this.#speeds.get(id) ?? 0;
  }

  forget(id: string): void {
    this.#speeds.delete(id);
  }

  // A magnet waits: the next turn comes now, unless one is under way or coming.
  wake(): void {
    if (this.#stop.signal.aborted) return;
    // A paste during a turn goes out as soon as that turn ends, not a whole pace later.
    if (this.#turn !== undefined) {
      this.#again = true;
      return;
    }
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#run();
    }, 0);
    this.#timer.unref();
  }

  async close(): Promise<void> {
    this.#stop.abort();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    await this.#turn;
  }

  #run(): void {
    this.#timer = undefined;
    this.#turn = this.#once()
      .catch((error: unknown) => {
        if (this.#stop.signal.aborted) return;
        this.#deps.logger.warn('magnets_not_asked', { error: describeFailure(error) });
      })
      .finally(() => {
        this.#turn = undefined;
        const again = this.#again;
        this.#again = false;
        if (this.#stop.signal.aborted || !this.#deps.records().some(isWaiting)) return;
        this.#timer = setTimeout(
          () => {
            this.#run();
          },
          again ? 0 : (this.#deps.pollMs ?? MAGNET_POLL_MS),
        );
        this.#timer.unref();
      });
  }

  #mine(record: MagnetRecord): boolean {
    return !this.#stop.signal.aborted && this.#deps.records().includes(record);
  }

  #fail(record: MagnetRecord, failure: MagnetFailure): void {
    record.status = MagnetStatus.Failed;
    record.failure = failure;
    this.#speeds.delete(record.id);
  }

  async #once(): Promise<void> {
    const { service } = this.#deps;
    if (service === undefined) {
      for (const record of this.#deps.records().filter(isWaiting)) {
        this.#fail(record, MagnetFailure.NeedsService);
      }
      this.#deps.changed();
      return;
    }
    await this.#send(service);
    this.#deps.changed();
    await this.#ask(service);
    this.#deps.changed();
  }

  async #send(service: MagnetService): Promise<void> {
    const sending = this.#deps.records().filter((record) => record.status === MagnetStatus.Sending);
    if (sending.length === 0) return;
    try {
      const sent = await service.send(
        sending.map((record) => record.magnet),
        this.#stop.signal,
      );
      sending.forEach((record, index) => {
        const said = sent[index];
        if (said === undefined) return;
        if ('failure' in said) {
          this.#fail(record, said.failure);
          return;
        }
        record.serviceId = said.taken.id;
        // 0 before the service has read the torrent: no size yet.
        record.totalBytes = said.taken.size > 0 ? said.taken.size : null;
        record.status = MagnetStatus.Fetching;
        record.failure = null;
      });
    } catch (error) {
      this.#stop.signal.throwIfAborted();
      const failure = failureOf(error);
      for (const record of sending) {
        if (failure === undefined) record.failure = MagnetFailure.Unavailable;
        else this.#fail(record, failure);
      }
    }
  }

  async #ask(service: MagnetService): Promise<void> {
    const fetching = this.#deps
      .records()
      .filter((record) => record.status === MagnetStatus.Fetching && record.serviceId !== null);
    if (fetching.length === 0) return;
    let states;
    try {
      states = await service.states(this.#stop.signal);
    } catch (error) {
      this.#stop.signal.throwIfAborted();
      const failure = failureOf(error);
      for (const record of fetching) {
        if (failure === undefined) record.failure = MagnetFailure.Unavailable;
        else this.#fail(record, failure);
      }
      return;
    }
    const ready: MagnetRecord[] = [];
    for (const record of fetching) {
      const state = states.find((each) => each.id === record.serviceId);
      // Gone from the account — deleted on the service's site — or failed there.
      if (state === undefined || state.stage === 'failed') {
        this.#fail(record, MagnetFailure.Failed);
        continue;
      }
      // An answer about it Scia cannot read would be the same at every turn.
      if (state.stage === 'unreadable') {
        this.#fail(record, MagnetFailure.Unavailable);
        continue;
      }
      if (state.name !== '' && state.name !== 'noname') record.name = state.name;
      record.totalBytes = state.size > 0 ? state.size : null;
      record.downloadedBytes = state.downloaded;
      record.failure = null;
      // A magnet removed while the service answered keeps nothing here.
      if (this.#mine(record)) this.#speeds.set(record.id, state.bytesPerSecond);
      if (state.stage === 'ready') ready.push(record);
    }
    if (ready.length > 0) await this.#collect(service, ready);
  }

  // The files of every magnet ready this turn, in one question (ADR 0014, point 2).
  async #collect(service: MagnetService, ready: readonly MagnetRecord[]): Promise<void> {
    let answered;
    try {
      answered = await service.files(
        ready.map((record) => record.serviceId ?? 0),
        this.#stop.signal,
      );
    } catch (error) {
      this.#stop.signal.throwIfAborted();
      const failure = failureOf(error);
      for (const record of ready) {
        if (failure === undefined) record.failure = MagnetFailure.Unavailable;
        else this.#fail(record, failure);
      }
      return;
    }
    for (const record of ready) {
      if (!this.#mine(record)) continue;
      // One the service left out of its answer is failed as its upload would be: asking again
      // would be asked again for ever.
      const files = answered.get(record.serviceId ?? 0) ?? MagnetFailure.Unavailable;
      if (typeof files === 'string') {
        this.#fail(record, files);
        continue;
      }
      this.#speeds.delete(record.id);
      this.#deps.ready(record, files);
    }
  }
}

// What a magnet is called before the service says: the name it carries, or its hash.
export function nameOfMagnet(magnet: string): string {
  const query = magnet.slice(magnet.indexOf('?') + 1);
  const name = new URLSearchParams(query).get('dn')?.trim();
  return name === undefined || name === '' ? hashOfMagnet(magnet) : name;
}
