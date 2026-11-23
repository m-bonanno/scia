import { setTimeout as sleep } from 'node:timers/promises';
import { isIntegrationId, KEY_SEAL_LIMIT_MS } from '@scia/contracts';
import type { KeyAnswer, KeyRequest } from '@scia/server';

// What seals a key so that only this account on this computer reads it back: the operating
// system's protected storage, through Electron.
export interface KeyCipher {
  // False where the system has nothing that protects a key.
  readonly available: () => boolean;
  readonly encrypt: (key: string) => Uint8Array;
  readonly decrypt: (kept: Uint8Array) => string;
  // Whether what opens a key sealed now is on disk, for the next start to read: a key sealed
  // before it gets there cannot be read back once the app is killed (docs/adr/0023).
  readonly sealKept: () => Promise<boolean>;
}

// How often a write looks again for what opens its key: the file is Chromium's, which renames
// onto it, and is read no more often than that.
const SEAL_POLL_MS = 250;

// Whether the profile's `Local State`, as Chromium writes it, holds the key it seals with on
// Windows: the system's Data Protection API seals that key, Chromium seals every value with it.
export function holdsSealingKey(localState: string): boolean {
  try {
    const state = JSON.parse(localState) as { os_crypt?: { encrypted_key?: unknown } } | null;
    const key = state?.os_crypt?.encrypted_key;
    return typeof key === 'string' && key !== '';
  } catch {
    return false;
  }
}

// Where the sealed keys are, one file per service. A name it is given is a service's id.
export interface KeyFiles {
  // Undefined when nothing is kept under the name.
  readonly read: (name: string) => Promise<Uint8Array | undefined>;
  readonly write: (name: string, kept: Uint8Array) => Promise<void>;
  readonly remove: (name: string) => Promise<void>;
}

export interface KeyVaultDeps {
  readonly cipher: KeyCipher;
  readonly files: KeyFiles;
  readonly log: {
    info(message: string, details: object): void;
    warn(message: string, details: object): void;
  };
  readonly sealLimitMs?: number;
  readonly sealPollMs?: number;
}

// On Linux Electron says it can encrypt also when no keyring is there, and then seals with a
// password written in the program: that is not protection, and a key is not kept under it.
export function isProtectedStorage(system: {
  readonly platform: string;
  readonly available: boolean;
  // What Electron seals with, where it says: only on Linux.
  readonly backend: string | undefined;
}): boolean {
  if (!system.available) return false;
  return system.platform !== 'linux' || !['basic_text', 'unknown'].includes(system.backend ?? '');
}

const ACTIONS: readonly unknown[] = ['read', 'write', 'remove'] satisfies KeyRequest['action'][];

type KeyRequestLike = Record<keyof KeyRequest, unknown> & {
  readonly id: number;
  readonly action: KeyRequest['action'];
};

function isKeyRequest(message: unknown): message is KeyRequestLike {
  if (typeof message !== 'object' || message === null) return false;
  const request = message as Partial<Record<keyof KeyRequest, unknown>>;
  return (
    request.type === 'key' && typeof request.id === 'number' && ACTIONS.includes(request.action)
  );
}

// The keys of the services the engine is connected to (docs/adr/0004). The engine asks, main
// keeps: a key is on disk only sealed by the system, and never where the system cannot seal.
export class KeyVault {
  readonly #deps: KeyVaultDeps;
  // One request at a time, in the order they came: a write that is slow never lands after
  // the removal that was asked after it.
  #last: Promise<unknown> = Promise.resolve();
  // Once on disk, what opens a key stays there: it is not looked for again.
  #sealOnDisk = false;

  constructor(deps: KeyVaultDeps) {
    this.#deps = deps;
  }

  // Has the system make what opens a key now, at the start, when it is not on disk yet: it
  // reaches the disk some seconds later, long before a person connects a service, who then waits
  // for nothing. It never fails the start.
  async prepare(): Promise<void> {
    const { cipher } = this.#deps;
    try {
      if (await this.#sealKept()) return;
      if (!cipher.available()) return;
      cipher.encrypt('');
      this.#deps.log.info('key_seal_prepared', {});
    } catch (error) {
      this.#deps.log.warn('key_seal_not_prepared', { error: String(error) });
    }
  }

  // What main answers to a message of the engine's; undefined for one that asks for no key.
  // It never rejects: a refusal is an answer.
  answer(message: unknown): Promise<KeyAnswer | undefined> {
    if (!isKeyRequest(message)) return Promise.resolve(undefined);
    const answered = this.#last.then(() => this.#answer(message));
    this.#last = answered;
    return answered;
  }

  async #answer(message: KeyRequestLike): Promise<KeyAnswer> {
    const { id, action, name } = message;
    try {
      // The name becomes a file's name: only a service's id is one.
      if (!isIntegrationId(name)) throw new Error('Not a service.');
      const key = await this.#act(action, name, message.key);
      return { type: 'key', id, ok: true, ...(key === undefined ? {} : { key }) };
    } catch (error) {
      this.#deps.log.warn('key_refused', {
        action,
        service: isIntegrationId(name) ? name : 'unknown',
        error: String(error),
      });
      return { type: 'key', id, ok: false };
    }
  }

  async #act(
    action: KeyRequest['action'],
    name: string,
    key: unknown,
  ): Promise<string | undefined> {
    const { cipher, files } = this.#deps;
    switch (action) {
      case 'read': {
        const kept = await files.read(name);
        return kept === undefined ? undefined : cipher.decrypt(kept);
      }
      case 'write':
        if (typeof key !== 'string' || key === '') throw new Error('Not a key.');
        if (!cipher.available()) throw new Error('This system has no protected storage.');
        await files.write(name, cipher.encrypt(key));
        await this.#waitForSeal(name);
        return undefined;
      case 'remove':
        await files.remove(name);
        return undefined;
    }
  }

  // A key is said kept only once what opens it is on disk: one the person was told is connected
  // is read back at the next start, however soon the app is killed (#69). The engine undoes a
  // write refused here, as any other.
  async #waitForSeal(name: string): Promise<void> {
    const limitMs = this.#deps.sealLimitMs ?? KEY_SEAL_LIMIT_MS;
    const started = performance.now();
    const sealOnDisk = await this.#sealKept();
    let kept = sealOnDisk;
    while (!kept) {
      if (performance.now() - started >= limitMs) {
        throw new Error('What opens the key did not reach the disk.');
      }
      await sleep(this.#deps.sealPollMs ?? SEAL_POLL_MS);
      kept = await this.#sealKept();
    }
    this.#deps.log.info('key_kept', {
      service: name,
      sealOnDisk,
      waitedMs: sealOnDisk ? 0 : Math.round(performance.now() - started),
    });
  }

  async #sealKept(): Promise<boolean> {
    this.#sealOnDisk ||= await this.#deps.cipher.sealKept();
    return this.#sealOnDisk;
  }
}
