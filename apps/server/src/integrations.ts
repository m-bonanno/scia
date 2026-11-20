import { type Integration, type IntegrationAccount, IntegrationId } from '@scia/contracts';
import { ServiceFailure } from '@scia/core';
import { type AllDebrid, ServiceError } from './alldebrid.ts';
import type { KeyVault } from './key-vault.ts';
import { describeFailure, type Logger } from './logger.ts';

// What the service said of the account is believed for this long: Settings may be opened many
// times, the service is asked once.
const ACCOUNT_FRESH_MS = 60_000;

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
// given back to whoever calls.
export class Integrations {
  readonly #deps: IntegrationsDeps;
  #key: string | undefined;
  #account: IntegrationAccount | null = null;
  #failure: ServiceFailure | null = null;
  #askedAt: number | undefined;
  #asking: Promise<void> | undefined;

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
    this.#account = null;
    this.#failure = null;
    this.#askedAt = undefined;
    this.#deps.logger.info('service_disconnected', { service: id });
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
      failure = error instanceof ServiceError ? error.failure : ServiceFailure.Unavailable;
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
