import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  type Integration,
  type IntegrationAccount,
  type IntegrationCode,
  IntegrationCodeFailure,
  IntegrationCodeStatus,
  IntegrationId,
} from '@scia/contracts';
import {
  type BundleFailure,
  type MagnetFailure,
  isServiceFailure,
  ServiceFailure,
  UnlockFailure,
} from '@scia/core';
import type { AllDebrid } from './alldebrid.ts';
import type { KeyVault } from './key-vault.ts';
import type { LinkResolver, OpenedLink, UnlockedLink } from './link-resolver.ts';
import type { MagnetFile, MagnetService, MagnetState, SentMagnet } from './magnet-service.ts';
import { describeFailure, type Logger } from './logger.ts';
import { CodeExpiredError, ServiceError } from './service-error.ts';

// What the service said of the account is believed for this long: Settings may be opened many
// times, the service is asked once.
const ACCOUNT_FRESH_MS = 60_000;
// The hosts a service unlocks change rarely: its list is read again this often.
const HOSTS_FRESH_MS = 6 * 60 * 60_000;
// After a reading that failed, the list it had is used this long before the service is asked
// again: a service that does not answer is not asked once for every link.
const HOSTS_RETRY_MS = 60_000;
// With no service connected, a public list that could not be read is asked again only this
// much later: a direct link waits on each reading, and nobody asked Scia to speak to the
// service (#49).
const PUBLIC_HOSTS_RETRY_MS = 60 * 60_000;
// A code is asked about this often while the person confirms it: the documentation's example
// waits five seconds between two questions.
const CODE_POLL_MS = 5000;

// `work`, or the reason of `signal` as soon as it stops: what many wait for together is not
// stopped by one of them leaving.
function unlessStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => {
      reject(signal.reason as Error);
    };
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener('abort', stop, { once: true });
    void work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', stop);
    });
  });
}

function hostNameOf(url: string): string | undefined {
  // As the platform reads it: in lower case, whatever was pasted.
  return URL.parse(url)?.hostname;
}
// A listing waits this long for the service to say whose account it is, and then answers what
// it knows: Settings is not kept waiting by a service that is slow. The answer, when it comes,
// is there for the next listing.
const LIST_WAIT_MS = 2000;

// The list kept by an earlier run, read as old: the first link of a run waits for the service
// to be asked again, and goes by the kept list when it does not answer.
async function keptHosts(deps: IntegrationsDeps): Promise<HostList | undefined> {
  if (deps.hostsFile === undefined) return undefined;
  try {
    const kept: unknown = JSON.parse(await readFile(deps.hostsFile, 'utf8'));
    return isDomainList(kept) ? { domains: kept.domains, readAt: -Infinity } : undefined;
  } catch {
    return undefined;
  }
}

export class KeyNotKeptError extends Error {
  override readonly name = 'KeyNotKeptError';
}

// A code that is not given: the service is connected, or the wait was ended — by Cancel, by a
// pasted key, by another code — while the service was giving it.
export class CodeConflictError extends Error {
  override readonly name = 'CodeConflictError';
}

export interface IntegrationsDeps {
  readonly vault: KeyVault;
  readonly alldebrid: AllDebrid;
  readonly logger: Logger;
  // A clock that never steps, in milliseconds.
  readonly now?: () => number;
  readonly listWaitMs?: number;
  readonly codePollMs?: number;
  // Where the last list of hosts the service gave is kept between runs, so that a run in which
  // the service does not answer still knows which links are its own (the owner's decision, #7).
  // Nothing is kept without it.
  readonly hostsFile?: string;
}

interface HostList {
  readonly domains: readonly string[];
  // On this run's clock; a list kept from another run is read as old.
  readonly readAt: number;
}

// A code being confirmed on the service's site, and what the engine needs to ask for its key.
interface PendingCode {
  readonly code: string;
  readonly url: string;
  // What the service gives the key for: never logged, never in an answer.
  readonly check: string;
  readonly expiresAt: string;
  // On the clock that never steps.
  readonly endsAt: number;
  readonly stop: AbortController;
  status: IntegrationCodeStatus;
  failure: IntegrationCodeFailure | null;
}

function codeFailureOf(error: unknown): IntegrationCodeFailure {
  if (error instanceof KeyNotKeptError) return IntegrationCodeFailure.KeyNotKept;
  if (error instanceof CodeExpiredError) return error.failure;
  if (error instanceof ServiceError && isServiceFailure(error.failure)) return error.failure;
  return ServiceFailure.Unavailable;
}

function isDomainList(value: unknown): value is { readonly domains: string[] } {
  const domains = (value as { domains?: unknown } | null)?.domains;
  return Array.isArray(domains) && domains.every((domain) => typeof domain === 'string');
}

// The services Scia is connected to: the key of each, held in memory and kept by the vault,
// and what the service last said of the account behind it. A key is never logged and never
// given back to whoever calls. It is also what a download asks whether a link is a service's,
// and for the direct link behind it (link-resolver.ts).
export class Integrations implements LinkResolver, MagnetService {
  readonly #deps: IntegrationsDeps;
  #key: string | undefined;
  #account: IntegrationAccount | null = null;
  #failure: ServiceFailure | null = null;
  #askedAt: number | undefined;
  #asking: Promise<void> | undefined;
  // The domains the service unlocks links of, when they were read, and the reading under way.
  #hosts: HostList | undefined;
  // Forgotten with the list when another key, or none, is connected: that key asks again.
  #readingHosts: Promise<readonly string[]> | undefined;
  // The file hosts the service lists to anyone, read while no service is connected (#49).
  #publicHosts: HostList | undefined;
  // When a first reading failed, with no list read before it: the next is an hour later.
  #publicHostsFailedAt: number | undefined;
  #readingPublicHosts: Promise<readonly string[]> | undefined;
  // Connecting and disconnecting, one after the other: two at once would write one key over
  // another, in an order nobody chose.
  #changing: Promise<unknown> = Promise.resolve();
  // The code the person was given to confirm on the service's site, if any (#136).
  #code: PendingCode | undefined;
  // Moved on by every end of a wait: a code the service gives after it is nobody's.
  #codeTurn = 0;

  // A key was kept and could not be read back at this start (docs/adr/0023): said in Settings
  // until a key is connected again or the service disconnected.
  #keyNotRead: boolean;

  constructor(
    deps: IntegrationsDeps,
    kept: { readonly key: string | undefined; readonly notRead: boolean },
    hosts?: HostList,
  ) {
    this.#deps = deps;
    this.#key = kept.key;
    this.#keyNotRead = kept.notRead;
    this.#hosts = hosts;
  }

  static async open(deps: IntegrationsDeps): Promise<Integrations> {
    let key: string | undefined;
    let notRead = false;
    try {
      key = await deps.vault.read(IntegrationId.AllDebrid);
    } catch (error) {
      // A key nobody can read back is no key: the person is told, and connects again.
      notRead = true;
      deps.logger.warn('key_not_read', {
        service: IntegrationId.AllDebrid,
        error: describeFailure(error),
      });
    }
    return new Integrations(deps, { key, notRead }, await keptHosts(deps));
  }

  async list(): Promise<Integration[]> {
    const given = new AbortController();
    await Promise.race([
      this.#refresh(),
      sleep(this.#deps.listWaitMs ?? LIST_WAIT_MS, undefined, { signal: given.signal }).catch(
        () => undefined,
      ),
    ]);
    given.abort();
    return [this.#view()];
  }

  // Asks the service whose key it is, and only then keeps it. Rejects with a ServiceError when
  // the service does not take it or cannot be asked, with a KeyNotKeptError when the system
  // will not keep it — and what was connected before stays as it was.
  // A key pasted while a code waits is the one the person chose: the code no longer connects.
  connect(id: IntegrationId, apiKey: string): Promise<Integration> {
    this.cancelCode(id);
    return this.#oneAtATime(async () => {
      const connected = await this.#connect(id, apiKey);
      // A code given while this key was checked would replace it once confirmed.
      this.cancelCode(id);
      return connected;
    });
  }

  // The key leaves the vault first: one that stayed there would connect Scia again by itself
  // at its next start.
  disconnect(id: IntegrationId): Promise<void> {
    return this.#oneAtATime(() => this.#disconnect(id));
  }

  // A code for the person to confirm on the service's site. From then on the service is asked,
  // every few seconds, whether it was confirmed; once it is, the key it gives is connected as a
  // pasted one is. A new code ends the wait for the one before. Rejects with a ServiceError when
  // the service gives no code.
  async startCode(id: IntegrationId): Promise<IntegrationCode> {
    if (this.#key !== undefined) {
      throw new CodeConflictError('The service is connected: a code would replace its key.');
    }
    this.cancelCode(id);
    const turn = this.#codeTurn;
    const given = await this.#deps.alldebrid.code();
    // The turn moved meanwhile: Cancel, another code, a key pasted — or a key kept, which moves it
    // too, so that a code given while a key was checked is not given.
    if (turn !== this.#codeTurn) {
      throw new CodeConflictError('The wait for this code was ended while it was given.');
    }
    const pending: PendingCode = {
      code: given.code,
      url: given.url,
      check: given.check,
      expiresAt: new Date(Date.now() + given.expiresInSeconds * 1000).toISOString(),
      endsAt: this.#now() + given.expiresInSeconds * 1000,
      stop: new AbortController(),
      status: IntegrationCodeStatus.Waiting,
      failure: null,
    };
    this.#code = pending;
    this.#deps.logger.info('service_code_given', { service: id });
    void this.#waitFor(id, pending);
    return this.#codeView(pending);
  }

  // The code given last, and what became of it. One slot for every service: there is one.
  code(_id: IntegrationId): IntegrationCode | undefined {
    return this.#code === undefined ? undefined : this.#codeView(this.#code);
  }

  // With a code named, only that code: an ask that brought one late does not end a newer one.
  cancelCode(_id: IntegrationId, code?: string): void {
    if (code !== undefined && this.#code?.code !== code) return;
    this.#code?.stop.abort();
    this.#code = undefined;
    this.#codeTurn += 1;
  }

  async #waitFor(id: IntegrationId, pending: PendingCode): Promise<void> {
    const { signal } = pending.stop;
    try {
      for (;;) {
        const left = pending.endsAt - this.#now();
        if (left <= 0) {
          throw new CodeExpiredError(id, 'The code was not confirmed in time.');
        }
        // A wait nobody may be watching any longer never keeps the engine from ending.
        await sleep(Math.min(this.#deps.codePollMs ?? CODE_POLL_MS, left), undefined, {
          signal,
          ref: false,
        });
        const key = await this.#deps.alldebrid
          .confirmedKey(pending.code, pending.check, signal)
          .catch((error: unknown) => {
            // A service that cannot be asked for a moment is asked again at the next turn.
            if (error instanceof ServiceError && error.failure === ServiceFailure.Unavailable) {
              return undefined;
            }
            throw error;
          });
        if (key === undefined) continue;
        // In turn with the other changes: a wait ended while one of them ran connects nothing.
        await this.#oneAtATime(() => {
          signal.throwIfAborted();
          return this.#connect(id, key);
        });
        pending.status = IntegrationCodeStatus.Connected;
        return;
      }
    } catch (error) {
      if (signal.aborted) return;
      pending.status = IntegrationCodeStatus.Failed;
      pending.failure = codeFailureOf(error);
      this.#deps.logger.warn('service_code_failed', {
        service: id,
        failure: pending.failure,
        error: describeFailure(error),
      });
    }
  }

  #codeView(pending: PendingCode): IntegrationCode {
    return {
      code: pending.code,
      url: pending.url,
      expiresAt: pending.expiresAt,
      status: pending.status,
      failure: pending.failure,
    };
  }

  #oneAtATime<T>(change: () => Promise<T>): Promise<T> {
    // The chain never rejects: what failed before does not stop what comes after.
    const done = this.#changing.then(change);
    this.#changing = done.catch(() => undefined);
    return done;
  }

  async #connect(id: IntegrationId, apiKey: string): Promise<Integration> {
    const account = await this.#deps.alldebrid.account(apiKey);
    const before = this.#key;
    try {
      await this.#deps.vault.write(id, apiKey);
    } catch (error) {
      this.#deps.logger.error('key_not_kept', { service: id, error: describeFailure(error) });
      await this.#putBack(id, before);
      throw new KeyNotKeptError('The key could not be kept.', { cause: error });
    }
    this.#key = apiKey;
    this.#keyNotRead = false;
    // Another key may be another account, with other hosts.
    await this.#forgetHosts();
    this.#account = account;
    this.#failure = null;
    this.#askedAt = this.#now();
    this.#deps.logger.info('service_connected', { service: id });
    return this.#view();
  }

  // A write that was given up on — a vault that answered too late — may still land. The vault
  // is asked to be what it was, so that the next start finds what Scia says is connected, and
  // never a key the person was told was not kept.
  async #putBack(id: IntegrationId, before: string | undefined): Promise<void> {
    try {
      if (before === undefined) await this.#deps.vault.remove(id);
      else await this.#deps.vault.write(id, before);
    } catch (error) {
      this.#deps.logger.error('key_not_put_back', { service: id, error: describeFailure(error) });
    }
  }

  async #disconnect(id: IntegrationId): Promise<void> {
    await this.#deps.vault.remove(id);
    this.#key = undefined;
    this.#keyNotRead = false;
    await this.#forgetHosts();
    this.#account = null;
    this.#failure = null;
    this.#askedAt = undefined;
    this.#deps.logger.info('service_disconnected', { service: id });
  }

  async serviceFor(url: string, signal: AbortSignal): Promise<IntegrationId | undefined> {
    const key = this.#key;
    const host = hostNameOf(url);
    if (host === undefined) return undefined;
    if (key === undefined) {
      // A file host's page is on its own domain, or on its www; its other names are the
      // servers of its files, which give them to anyone: those links go as they stand.
      const isFileHostPage = (domains: readonly string[]) =>
        domains.some((domain) => host === domain || host === `www.${domain}`);
      const needsService = () =>
        new ServiceError(
          IntegrationId.AllDebrid,
          UnlockFailure.NeedsService,
          "A file host's link, and no service is connected.",
        );
      // While the kept key cannot be read, the list its account gave in a run before still says
      // which hosts are the person's, also when the public list cannot be read (#69).
      if (this.#keyNotRead && isFileHostPage(this.#hosts?.domains ?? [])) throw needsService();
      const domains = await unlessStopped(this.#publicDomains(), signal);
      // A service connected while the list was read is the one that decides.
      if (this.#key !== undefined) return this.serviceFor(url, signal);
      if (isFileHostPage(domains)) throw needsService();
      return undefined;
    }
    const domains = await unlessStopped(this.#domains(key), signal);
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
      ? IntegrationId.AllDebrid
      : undefined;
  }

  hasService(): boolean {
    return this.#key !== undefined;
  }

  async send(magnets: readonly string[], signal?: AbortSignal): Promise<SentMagnet[]> {
    return this.#deps.alldebrid.uploadMagnets(this.#keyForMagnets(), magnets, signal);
  }

  async states(signal?: AbortSignal): Promise<MagnetState[]> {
    return this.#deps.alldebrid.magnetStates(this.#keyForMagnets(), signal);
  }

  async files(
    ids: readonly number[],
    signal?: AbortSignal,
  ): Promise<Map<number, MagnetFile[] | MagnetFailure>> {
    return this.#deps.alldebrid.magnetFiles(this.#keyForMagnets(), ids, signal);
  }

  // A magnet goes through a service or nowhere: Scia is not a torrent client.
  #keyForMagnets(): string {
    const key = this.#key;
    if (key === undefined) {
      throw new ServiceError(
        IntegrationId.AllDebrid,
        UnlockFailure.NeedsService,
        'A magnet, and no service is connected.',
      );
    }
    return key;
  }

  async unlock(service: IntegrationId, url: string, signal: AbortSignal): Promise<UnlockedLink> {
    const key = this.#key;
    if (key === undefined) {
      throw new ServiceError(service, UnlockFailure.NotConnected, 'The service is not connected.');
    }
    return this.#deps.alldebrid.unlock(key, url, signal);
  }

  async open(
    service: IntegrationId,
    url: string,
    signal: AbortSignal,
  ): Promise<OpenedLink | typeof BundleFailure.Empty | typeof BundleFailure.TooMany> {
    const key = this.#key;
    // Nothing was ever this service's: it is the service to connect, not one that left.
    if (key === undefined) {
      throw new ServiceError(service, UnlockFailure.NeedsService, 'No service is connected.');
    }
    return this.#deps.alldebrid.openLink(key, url, signal);
  }

  // One reading at a time, for every download that waits for it. A list that cannot be read
  // again is still the list: the one before it is used. With none at all the reading fails:
  // a link is not started on a guess.
  #domains(key: string): Promise<readonly string[]> {
    const known = this.#hosts;
    if (known !== undefined && this.#now() - known.readAt < HOSTS_FRESH_MS) {
      return Promise.resolve(known.domains);
    }
    if (this.#readingHosts !== undefined) return this.#readingHosts;
    const reading = this.#deps.alldebrid
      .domains(key)
      .then(
        async (domains) => {
          // In turn with connecting and disconnecting, which forget the list: a list written
          // while a key was being forgotten would outlive it.
          await this.#oneAtATime(async () => {
            // An answer about a key that is no longer the one: it is nobody's list now.
            if (this.#key !== key) return;
            this.#hosts = { domains, readAt: this.#now() };
            await this.#keepHosts(domains);
          });
          return domains;
        },
        (error: unknown) => {
          this.#deps.logger.warn('service_hosts_not_read', {
            service: IntegrationId.AllDebrid,
            error: describeFailure(error),
          });
          if (known === undefined) throw error;
          if (this.#key === key) {
            this.#hosts = {
              domains: known.domains,
              readAt: this.#now() - HOSTS_FRESH_MS + HOSTS_RETRY_MS,
            };
          }
          return known.domains;
        },
      )
      .finally(() => {
        if (this.#readingHosts === reading) this.#readingHosts = undefined;
      });
    this.#readingHosts = reading;
    return reading;
  }

  // As the account's list: read when first needed and every six hours, one reading for every
  // link that waits. One that cannot be read leaves the links to go as they stand — as they
  // did before #49 — and is asked again an hour later.
  #publicDomains(): Promise<readonly string[]> {
    const known = this.#publicHosts;
    if (known !== undefined && this.#now() - known.readAt < HOSTS_FRESH_MS) {
      return Promise.resolve(known.domains);
    }
    const failedAt = this.#publicHostsFailedAt;
    if (known === undefined && failedAt !== undefined) {
      if (this.#now() - failedAt < PUBLIC_HOSTS_RETRY_MS) return Promise.resolve([]);
    }
    if (this.#readingPublicHosts !== undefined) {
      return known === undefined ? this.#readingPublicHosts : Promise.resolve(known.domains);
    }
    const reading = this.#deps.alldebrid
      .publicDomains()
      .then(
        (domains) => {
          this.#publicHosts = { domains, readAt: this.#now() };
          return domains;
        },
        (error: unknown) => {
          this.#deps.logger.warn('service_public_hosts_not_read', {
            service: IntegrationId.AllDebrid,
            error: describeFailure(error),
          });
          if (known === undefined) {
            this.#publicHostsFailedAt = this.#now();
            return [];
          }
          this.#publicHosts = {
            domains: known.domains,
            readAt: this.#now() - HOSTS_FRESH_MS + PUBLIC_HOSTS_RETRY_MS,
          };
          return known.domains;
        },
      )
      .finally(() => {
        this.#readingPublicHosts = undefined;
      });
    this.#readingPublicHosts = reading;
    // A list read before goes on being the list while it is read again: nobody waits on a
    // refresh. Only a run that has none waits, three seconds at most.
    return known === undefined ? reading : Promise.resolve(known.domains);
  }

  async #keepHosts(domains: readonly string[]): Promise<void> {
    const file = this.#deps.hostsFile;
    if (file === undefined) return;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify({ domains }));
      await rename(`${file}.tmp`, file);
    } catch (error) {
      this.#deps.logger.warn('service_hosts_not_kept', { error: describeFailure(error) });
    }
  }

  async #forgetHosts(): Promise<void> {
    this.#hosts = undefined;
    this.#readingHosts = undefined;
    const file = this.#deps.hostsFile;
    if (file === undefined) return;
    await rm(file, { force: true }).catch((error: unknown) => {
      this.#deps.logger.warn('service_hosts_not_forgotten', { error: describeFailure(error) });
    });
  }

  #now(): number {
    return (this.#deps.now ?? performance.now.bind(performance))();
  }

  #view(): Integration {
    return {
      id: IntegrationId.AllDebrid,
      connected: this.#key !== undefined,
      account: this.#account,
      failure: this.#failure,
      keyNotRead: this.#keyNotRead,
    };
  }

  // One question to the service at a time, whoever lists meanwhile.
  #refresh(): Promise<void> {
    const key = this.#key;
    const fresh = this.#askedAt !== undefined && this.#now() - this.#askedAt < ACCOUNT_FRESH_MS;
    if (key === undefined || fresh) return Promise.resolve();
    this.#asking ??= this.#ask(key).finally(() => {
      this.#asking = undefined;
    });
    return this.#asking;
  }

  async #ask(key: string): Promise<void> {
    let account: IntegrationAccount | null = null;
    let failure: ServiceFailure | null = null;
    try {
      account = await this.#deps.alldebrid.account(key);
    } catch (error) {
      failure =
        error instanceof ServiceError && isServiceFailure(error.failure)
          ? error.failure
          : ServiceFailure.Unavailable;
      this.#deps.logger.warn('service_account_not_read', {
        service: IntegrationId.AllDebrid,
        failure,
        error: describeFailure(error),
      });
    }
    // Disconnected, or connected with another key, while the service was asked: this answer
    // is about a key that is gone.
    if (this.#key !== key) return;
    // A service that does not answer says nothing new of the account: what was known stays.
    this.#account = failure === ServiceFailure.Unavailable ? this.#account : account;
    this.#failure = failure;
    this.#askedAt = this.#now();
  }
}
