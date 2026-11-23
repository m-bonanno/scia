import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import {
  holdsSealingKey,
  isProtectedStorage,
  type KeyCipher,
  type KeyFiles,
} from './engine/key-vault.ts';

// Where Chromium keeps the key it seals with in the profile, and writes it some seconds after it
// made it (docs/adr/0023): on Windows, sealed by the Data Protection API in `Local State`.
// Elsewhere the system's keychain or keyring keeps it, and has it as soon as it is made.
const SEALING_KEY_IN_LOCAL_STATE: ReadonlySet<NodeJS.Platform> = new Set(['win32']);

async function localStateHoldsSealingKey(profile: string): Promise<boolean> {
  try {
    return holdsSealingKey(await readFile(join(profile, 'Local State'), 'utf8'));
  } catch {
    // Not written yet, or caught as Chromium renames onto it: the next look tells.
    return false;
  }
}

// The system's protected storage: DPAPI on Windows, the desktop's keyring on Linux.
export function systemCipher(profile: string): KeyCipher {
  return {
    available: () =>
      isProtectedStorage({
        platform: process.platform,
        available: safeStorage.isEncryptionAvailable(),
        backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined,
      }),
    encrypt: (key) => safeStorage.encryptString(key),
    decrypt: (kept) => safeStorage.decryptString(Buffer.from(kept)),
    sealKept: SEALING_KEY_IN_LOCAL_STATE.has(process.platform)
      ? () => localStateHoldsSealingKey(profile)
      : () => Promise.resolve(true),
  };
}

// The sealed keys, one small file each in a folder of the profile.
export class KeyFolder implements KeyFiles {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  readonly read = async (name: string): Promise<Uint8Array | undefined> => {
    try {
      return await readFile(this.#path(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };

  readonly write = async (name: string, kept: Uint8Array): Promise<void> => {
    await mkdir(this.#directory, { recursive: true });
    const temporary = this.#temporary(name);
    try {
      await writeFile(temporary, kept, { mode: 0o600 });
      await rename(temporary, this.#path(name));
    } catch (error) {
      // A sealed key is not left behind under another name.
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  readonly remove = async (name: string): Promise<void> => {
    await rm(this.#path(name), { force: true });
    await rm(this.#temporary(name), { force: true });
  };

  #path(name: string): string {
    return join(this.#directory, `${name}.key`);
  }

  #temporary(name: string): string {
    return `${this.#path(name)}.tmp`;
  }
}
