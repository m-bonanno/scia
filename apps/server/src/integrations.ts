import { type Integration, type IntegrationAccount, IntegrationId } from '@scia/contracts';
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
  return URL.parse(url)?.hostname.toLowerCase();
}

export class KeyNotKeptError extends Error {
  override readonly name = 'KeyNotKeptError';
}

export interface IntegrationsDeps {
  readonly vault: KeyVault;
  readonly alldebrid: AllDebrid;
  readonly logger: Logger;
  // A clock that never steps, in milliseconds.
  readonly now?: () => number;
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
    await this.#refresh();
    return [this.#view()];
  }

  // Asks the service whose key it is, and only then keeps it. Rejects with a ServiceError when
  // the service does not take it or cannot be asked, with a KeyNotKeptError when the system
  // will not keep it — and what was connected before stays as it was.
  async connect(id: IntegrationId, apiKey: string): Promise<Integration> {
    const account = await this.#deps.alldebrid.account(apiKey);
    try {
      await this.#deps.vault.write(id, apiKey);
    } catch (error) {
      this.#deps.logger.error('key_not_kept', { service: id, error: describeFailure(error) });
      throw new KeyNotKeptError('The key could not be kept.', { cause: error });
    }
    this.#key = apiKey;
    this.#hosts = undefined;
    this.#account = account;
    this.#failure = null;
    this.#askedAt = this.#now();
    this.#deps.logger.info('service_connected', { service: id });
    return this.#view();
  }

  // The key leaves the vault first: one that stayed there would connect Scia again by itself
  // at its next start.
  async disconnect(id: IntegrationId): Promise<void> {
    await this.#deps.vault.remove(id);
    this.#key = undefined;
    this.#hosts = undefined;
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
