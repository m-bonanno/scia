import { describe, expect, it, vi } from 'vitest';
import { isProtectedStorage, type KeyCipher, type KeyFiles, KeyVault } from './key-vault.ts';

// Made up: no account anywhere has this key.
const KEY = 'spec-key-0000000000000000';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A cipher that can be told apart from none: what it writes is marked, and is not the key.
function aCipher(overrides: Partial<KeyCipher> = {}): KeyCipher {
  return {
    available: () => true,
    encrypt: (key) => encoder.encode(`sealed:${Buffer.from(key).toString('base64')}`),
    decrypt: (kept) => {
      const text = decoder.decode(kept);
      if (!text.startsWith('sealed:')) throw new Error('Not something this system sealed.');
      return Buffer.from(text.slice('sealed:'.length), 'base64').toString();
    },
    ...overrides,
  };
}

function someFiles(overrides: Partial<KeyFiles> = {}) {
  const kept = new Map<string, Uint8Array>();
  const files: KeyFiles = {
    read: (name) => Promise.resolve(kept.get(name)),
    write: (name, data) => {
      kept.set(name, data);
      return Promise.resolve();
    },
    remove: (name) => {
      kept.delete(name);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { files, kept };
}

function aVault(cipher: KeyCipher = aCipher(), store = someFiles()) {
  const warn = vi.fn<(message: string, details: object) => void>();
  return { vault: new KeyVault({ cipher, files: store.files, log: { warn } }), ...store, warn };
}

describe('KeyVault', () => {
  it('keeps a key sealed by the system: what is on disk is not the key', async () => {
    const { vault, kept } = aVault();

    const answer = await vault.answer({
      type: 'key',
      id: 1,
      action: 'write',
      name: 'alldebrid',
      key: KEY,
    });

    expect(answer).toEqual({ type: 'key', id: 1, ok: true });
    expect([...kept.keys()]).toEqual(['alldebrid']);
    expect(decoder.decode(kept.get('alldebrid'))).not.toContain(KEY);
  });

  it('gives back the key it kept', async () => {
    const { vault } = aVault();
    await vault.answer({ type: 'key', id: 1, action: 'write', name: 'alldebrid', key: KEY });

    expect(await vault.answer({ type: 'key', id: 2, action: 'read', name: 'alldebrid' })).toEqual({
      type: 'key',
      id: 2,
      ok: true,
      key: KEY,
    });
  });

  it('answers that there is no key when none was kept, also where nothing could seal one', async () => {
    const { vault } = aVault(aCipher({ available: () => false }));

    expect(await vault.answer({ type: 'key', id: 7, action: 'read', name: 'alldebrid' })).toEqual({
      type: 'key',
      id: 7,
      ok: true,
    });
  });

  it('removes a key, and it is gone', async () => {
    const { vault, kept } = aVault();
    await vault.answer({ type: 'key', id: 1, action: 'write', name: 'alldebrid', key: KEY });

    expect(await vault.answer({ type: 'key', id: 2, action: 'remove', name: 'alldebrid' })).toEqual(
      {
        type: 'key',
        id: 2,
        ok: true,
      },
    );

    expect(kept.size).toBe(0);
    expect(await vault.answer({ type: 'key', id: 3, action: 'read', name: 'alldebrid' })).toEqual({
      type: 'key',
      id: 3,
      ok: true,
    });
  });

  it('keeps no key where the system has nothing to seal it with, and writes nothing', async () => {
    const encrypt = vi.fn(aCipher().encrypt);
    const { vault, kept } = aVault(aCipher({ available: () => false, encrypt }));

    const answer = await vault.answer({
      type: 'key',
      id: 1,
      action: 'write',
      name: 'alldebrid',
      key: KEY,
    });

    expect(answer).toEqual({ type: 'key', id: 1, ok: false });
    expect(kept.size).toBe(0);
    expect(encrypt).not.toHaveBeenCalled();
  });

  it('refuses a name that is not a service it knows, and touches no file for it', async () => {
    const store = someFiles();
    const read = vi.spyOn(store.files, 'read');
    const write = vi.spyOn(store.files, 'write');
    const remove = vi.spyOn(store.files, 'remove');
    const { vault } = aVault(aCipher(), store);

    for (const name of ['../engine/state', 'C:\\Windows\\win', 'ALLDEBRID', '', 7, null]) {
      for (const action of ['read', 'write', 'remove']) {
        expect(await vault.answer({ type: 'key', id: 1, action, name, key: KEY })).toEqual({
          type: 'key',
          id: 1,
          ok: false,
        });
      }
    }

    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses to keep what is not a key', async () => {
    const { vault, kept } = aVault();

    for (const key of [undefined, '', 7]) {
      expect(
        await vault.answer({ type: 'key', id: 1, action: 'write', name: 'alldebrid', key }),
      ).toEqual({ type: 'key', id: 1, ok: false });
    }
    expect(kept.size).toBe(0);
  });

  it('says it could not, rather than fail, when the system or the disk refuses', async () => {
    const unsealable = aVault(
      aCipher({
        encrypt: () => {
          throw new Error('The system said no.');
        },
      }),
    );
    const unwritable = aVault(
      aCipher(),
      someFiles({ write: () => Promise.reject(new Error('EACCES')) }),
    );
    const unreadable = aVault();
    unreadable.kept.set('alldebrid', encoder.encode('sealed by another account'));
    const stuck = aVault(
      aCipher(),
      someFiles({ remove: () => Promise.reject(new Error('EPERM')) }),
    );
    const write = { type: 'key', id: 4, action: 'write', name: 'alldebrid', key: KEY };
    const refused = { type: 'key', id: 4, ok: false };

    expect(await unsealable.vault.answer(write)).toEqual(refused);
    expect(await unwritable.vault.answer(write)).toEqual(refused);
    expect(await unreadable.vault.answer({ ...write, action: 'read' })).toEqual(refused);
    expect(await stuck.vault.answer({ ...write, action: 'remove' })).toEqual(refused);
    expect(unreadable.warn).toHaveBeenCalledOnce();
  });

  it('does one thing at a time, in the order asked: a slow write never lands after the removal that followed it', async () => {
    const store = someFiles();
    const { write } = store.files;
    const slow = someFiles({
      read: store.files.read,
      remove: store.files.remove,
      write: async (name, data) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        await write(name, data);
      },
    });
    const { vault } = aVault(aCipher(), { files: slow.files, kept: store.kept });

    const answers = await Promise.all([
      vault.answer({ type: 'key', id: 1, action: 'write', name: 'alldebrid', key: KEY }),
      vault.answer({ type: 'key', id: 2, action: 'remove', name: 'alldebrid' }),
      vault.answer({ type: 'key', id: 3, action: 'read', name: 'alldebrid' }),
    ]);

    expect(answers.map((answer) => answer?.ok)).toEqual([true, true, true]);
    expect(answers[2]).toEqual({ type: 'key', id: 3, ok: true });
    expect(store.kept.size).toBe(0);
  });

  it('does not answer what is not a request for a key', async () => {
    const { vault } = aVault();

    for (const other of [
      null,
      'key',
      { type: 'ready', port: 47821 },
      { type: 'key', action: 'read', name: 'alldebrid' },
      { type: 'key', id: '1', action: 'read', name: 'alldebrid' },
      { type: 'key', id: 1, action: 'steal', name: 'alldebrid' },
    ]) {
      expect(await vault.answer(other), JSON.stringify(other)).toBeUndefined();
    }
  });

  it('never puts a key in the log', async () => {
    const { vault, warn } = aVault(aCipher({ available: () => false }));

    await vault.answer({ type: 'key', id: 1, action: 'write', name: 'alldebrid', key: KEY });
    await vault.answer({ type: 'key', id: 2, action: 'write', name: KEY, key: KEY });

    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
  });
});

describe('isProtectedStorage', () => {
  it('trusts the system that says it can encrypt, on Windows', () => {
    expect(isProtectedStorage({ platform: 'win32', available: true, backend: undefined })).toBe(
      true,
    );
    expect(isProtectedStorage({ platform: 'win32', available: false, backend: undefined })).toBe(
      false,
    );
  });

  it('does not take a password written in the program for protection, on Linux', () => {
    const linux = (backend: string) =>
      isProtectedStorage({ platform: 'linux', available: true, backend });

    expect(linux('gnome_libsecret')).toBe(true);
    expect(linux('kwallet6')).toBe(true);
    expect(linux('basic_text')).toBe(false);
    expect(linux('unknown')).toBe(false);
  });
});
