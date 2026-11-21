import {
  isServiceFailure,
  MagnetFailure,
  MagnetStatus,
  ServiceFailure,
  UnlockFailure,
} from '@scia/core';
import { describeFailure, type Logger } from './logger.ts';
import type { MagnetFile, MagnetService } from './magnet-service.ts';
import { MagnetError, ServiceError } from './service-error.ts';
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
  if (error instanceof MagnetError) return error.failure;
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
    if (this.#stop.signal.aborted || this.#turn !== undefined) return;
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
        if (this.#stop.signal.aborted || !this.#deps.records().some(isWaiting)) return;
        this.#timer = setTimeout(() => {
          this.#run();
        }, this.#deps.pollMs ?? MAGNET_POLL_MS);
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
        if (!this.#mine(record) || record.status !== MagnetStatus.Sending || said === undefined)
          return;
        if ('failure' in said) {
          this.#fail(record, said.failure);
          return;
        }
        record.serviceId = said.taken.id;
        // "noname": the service could not read one.
        if (said.taken.name !== '' && said.taken.name !== 'noname') record.name = said.taken.name;
        record.totalBytes = said.taken.size;
        record.status = MagnetStatus.Fetching;
        record.failure = null;
      });
    } catch (error) {
      this.#stop.signal.throwIfAborted();
      const failure = failureOf(error);
      for (const record of sending.filter((each) => this.#mine(each))) {
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
      for (const record of fetching.filter((each) => this.#mine(each))) {
        if (failure === undefined) record.failure = MagnetFailure.Unavailable;
        else this.#fail(record, failure);
      }
      return;
    }
    for (const record of fetching) {
      if (!this.#mine(record) || record.status !== MagnetStatus.Fetching) continue;
      const state = states.find((each) => each.id === record.serviceId);
      // Gone from the account — deleted on the service's site — or failed there.
      if (state === undefined || state.stage === 'failed') {
        this.#fail(record, MagnetFailure.Failed);
        continue;
      }
      if (state.name !== '' && state.name !== 'noname') record.name = state.name;
      record.totalBytes = state.size;
      record.downloadedBytes = state.downloaded;
      record.failure = null;
      this.#speeds.set(record.id, state.bytesPerSecond);
      if (state.stage === 'ready') await this.#collect(service, record, state.id);
    }
  }

  async #collect(service: MagnetService, record: MagnetRecord, id: number): Promise<void> {
    try {
      const files = await service.files(id, this.#stop.signal);
      if (!this.#mine(record)) return;
      this.#speeds.delete(record.id);
      this.#deps.ready(record, files);
    } catch (error) {
      this.#stop.signal.throwIfAborted();
      const failure = failureOf(error);
      if (!this.#mine(record)) return;
      if (failure === undefined) record.failure = MagnetFailure.Unavailable;
      else this.#fail(record, failure);
    }
  }
}

// The torrent a magnet names, however it was written: the same hash is the same magnet.
export function hashOfMagnet(magnet: string): string {
  return /xt=urn:btih:([0-9a-z]+)/i.exec(magnet)?.[1]?.toLowerCase() ?? magnet;
}

// What a magnet is called before the service says: the name it carries, or its hash.
export function nameOfMagnet(magnet: string): string {
  const query = magnet.slice(magnet.indexOf('?') + 1);
  const name = new URLSearchParams(query).get('dn')?.trim();
  return name === undefined || name === '' ? hashOfMagnet(magnet) : name;
}
