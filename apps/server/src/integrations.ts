import { type Integration, type IntegrationAccount, IntegrationId } from '@scia/contracts';
import { setTimeout as sleep } from 'node:timers/promises';
import { isServiceFailure, ServiceFailure, UnlockFailure } from '@scia/core';
import type { AllDebrid } from './alldebrid.ts';
import type { KeyVault } from './key-vault.ts';
import type { LinkResolver, UnlockedLink } from './link-resolver.ts';
import { describeFailure, type Logger } from './logger.ts';
import { ServiceError } from './service-error.ts';

// What the service said of the account is believed for this long: Settings may be opened many
// times, the service is asked once.
const ACCOUNT_FRESH_MS = 60_000;
// The hosts a service unlocks change rarely: its list is read again this often.
const HOSTS_FRESH_MS = 6 * 60 * 60_000;

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

export class KeyNotKeptError extends Error {
  override readonly name = 'KeyNotKeptError';
}

export interface IntegrationsDeps {
  readonly vault: KeyVault;
  readonly alldebrid: AllDebrid;
  readonly logger: Logger;
  // A clock that never steps, in milliseconds.
  readonly now?: () => number;
  readonly listWaitMs?: number;
}

// The services Scia is connected to: the key of each, held in memory and kept by the vault,
// and what the service last said of the account behind it. A key is never logged and never
// given back to whoever calls. It is also what a download asks whether a link is a service's,
// and for the direct link behind it (link-resolver.ts).
export class Integrations implements LinkResolver {
  readonly #deps: IntegrationsDeps;
  #key: string | undefined;
  #account: IntegrationAccount | null = null;
  #failure: ServiceFailure | null = null;
  #askedAt: number | undefined;
  #asking: Promise<void> | undefined;
  // The domains the service unlocks links of, when they were read, and the reading under way.
  #hosts: { readonly domains: readonly string[]; readonly readAt: number } | undefined;
  #readingHosts: Promise<readonly string[]> | undefined;
  // Connecting and disconnecting, one after the other: two at once would write one key over
  // another, in an order nobody chose.
  #changing: Promise<unknown> = Promise.resolve();

  constructor(deps: IntegrationsDeps, key: string | undefined) {
    this.#deps = deps;
    this.#key = key;
  }

  static async open(deps: IntegrationsDeps): Promise<Integrations> {
    let key: string | undefined;
    try {
      key = await deps.vault.read(IntegrationId.AllDebrid);
    } catch (error) {
      // A key nobody can read back is no key: the person connects again.
      deps.logger.warn('key_not_read', {
        service: IntegrationId.AllDebrid,
        error: describeFailure(error),
      });
    }
    return new Integrations(deps, key);
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
  connect(id: IntegrationId, apiKey: string): Promise<Integration> {
    return this.#oneAtATime(() => this.#connect(id, apiKey));
  }

  // The key leaves the vault first: one that stayed there would connect Scia again by itself
  // at its next start.
  disconnect(id: IntegrationId): Promise<void> {
    return this.#oneAtATime(() => this.#disconnect(id));
  }

  #oneAtATime<T>(change: () => Promise<T>): Promise<T> {
    const done = this.#changing.then(change, change);
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
    // Another key may be another account, with other hosts.
    this.#hosts = undefined;
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
    this.#account = null;
    this.#failure = null;
    this.#askedAt = undefined;
    this.#deps.logger.info('service_disconnected', { service: id });
  }

  async serviceFor(url: string, signal: AbortSignal): Promise<IntegrationId | undefined> {
    const key = this.#key;
    const host = hostNameOf(url);
    if (key === undefined || host === undefined) return undefined;
    const domains = await unlessStopped(this.#domains(key), signal);
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
      ? IntegrationId.AllDebrid
      : undefined;
  }

  async unlock(service: IntegrationId, url: string, signal: AbortSignal): Promise<UnlockedLink> {
    const key = this.#key;
    if (key === undefined) {
      throw new ServiceError(service, UnlockFailure.NotConnected, 'The service is not connected.');
    }
    return this.#deps.alldebrid.unlock(key, url, signal);
  }

  // One reading at a time, for every download that waits for it. A list that cannot be read
  // again is still the list: the one before it is used. With none at all the reading fails:
  // a link is not started on a guess.
  #domains(key: string): Promise<readonly string[]> {
    const known = this.#hosts;
    if (known !== undefined && this.#now() - known.readAt < HOSTS_FRESH_MS) {
      return Promise.resolve(known.domains);
    }
    this.#readingHosts ??= this.#deps.alldebrid
      .domains(key)
      .then(
        (domains) => {
          if (this.#key === key) this.#hosts = { domains, readAt: this.#now() };
          return domains;
        },
        (error: unknown) => {
          this.#deps.logger.warn('service_hosts_not_read', {
            service: IntegrationId.AllDebrid,
            error: describeFailure(error),
          });
          if (known === undefined || this.#key !== key) throw error;
          return known.domains;
        },
      )
      .finally(() => {
        this.#readingHosts = undefined;
      });
    return this.#readingHosts;
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
