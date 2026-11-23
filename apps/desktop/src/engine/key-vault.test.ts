import { describe, expect, it, vi } from 'vitest';
import {
  holdsSealingKey,
  isProtectedStorage,
  type KeyCipher,
  type KeyFiles,
  KeyVault,
  type KeyVaultDeps,
} from './key-vault.ts';

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
    sealKept: () => Promise.resolve(true),
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

function aVault(
  cipher: KeyCipher = aCipher(),
  store = someFiles(),
  seal: Pick<KeyVaultDeps, 'sealLimitMs' | 'sealPollMs'> = {},
) {
  const info = vi.fn<(message: string, details: object) => void>();
  const warn = vi.fn<(message: string, details: object) => void>();
  return {
    vault: new KeyVault({ cipher, files: store.files, log: { info, warn }, ...seal }),
    ...store,
    info,
    warn,
  };
}

// What opens a sealed key reaches the disk at the look after this many.
function sealOnDiskAfter(looks: number) {
  let looked = 0;
  return {
    sealKept: () => {
      looked += 1;
      return Promise.resolve(looked > looks);
    },
    looks: () => looked,
  };
}

const WRITE = { type: 'key', id: 1, action: 'write', name: 'alldebrid', key: KEY } as const;

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

  describe('what opens a key, on disk (#69)', () => {
    it('says a key is kept only once what opens it is on disk', async () => {
      const seal = sealOnDiskAfter(3);
      const { vault, kept } = aVault(aCipher({ sealKept: seal.sealKept }), someFiles(), {
        sealPollMs: 1,
      });

      const answer = await vault.answer(WRITE);

      expect(answer).toEqual({ type: 'key', id: 1, ok: true });
      expect(seal.looks()).toBe(4);
      expect(kept.has('alldebrid')).toBe(true);
    });

    it('refuses the key when what opens it does not reach the disk in time', async () => {
      const { vault, warn } = aVault(
        aCipher({ sealKept: () => Promise.resolve(false) }),
        someFiles(),
        { sealPollMs: 1, sealLimitMs: 30 },
      );

      expect(await vault.answer(WRITE)).toEqual({ type: 'key', id: 1, ok: false });
      expect(warn).toHaveBeenCalledWith(
        'key_refused',
        expect.objectContaining({ action: 'write', service: 'alldebrid' }),
      );
    });

    it('says in the log whether it was on disk at the write, and how long the write waited', async () => {
      const late = aVault(aCipher({ sealKept: sealOnDiskAfter(2).sealKept }), someFiles(), {
        sealPollMs: 5,
      });
      const there = aVault();

      await late.vault.answer(WRITE);
      await there.vault.answer(WRITE);

      expect(late.info).toHaveBeenCalledWith('key_kept', {
        service: 'alldebrid',
        sealOnDisk: false,
        waitedMs: expect.any(Number) as number,
      });
      expect((late.info.mock.calls[0]?.[1] as { waitedMs: number }).waitedMs).toBeGreaterThan(0);
      expect(there.info).toHaveBeenCalledWith('key_kept', {
        service: 'alldebrid',
        sealOnDisk: true,
        waitedMs: 0,
      });
      expect(JSON.stringify([late.info.mock.calls, there.info.mock.calls])).not.toContain(KEY);
    });

    it('looks for it no more once it was on disk: it stays there', async () => {
      const seal = sealOnDiskAfter(1);
      const { vault } = aVault(aCipher({ sealKept: seal.sealKept }), someFiles(), {
        sealPollMs: 1,
      });

      await vault.answer(WRITE);
      await vault.answer({ ...WRITE, id: 2 });

      expect(seal.looks()).toBe(2);
    });

    it('keeps what it saw on disk, also when an older look answers after it', async () => {
      // The start's look is held while a write's look finds it on disk; the start's then says
      // it was not there yet, which it was not when it looked.
      let release: (onDisk: boolean) => void = () => undefined;
      let looks = 0;
      const sealKept = () => {
        looks += 1;
        if (looks === 1) {
          return new Promise<boolean>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(true);
      };
      const { vault } = aVault(aCipher({ sealKept }), someFiles(), { sealPollMs: 1 });

      const preparing = vault.prepare();
      await vault.answer(WRITE);
      release(false);
      await preparing;
      await vault.answer({ ...WRITE, id: 2 });

      expect(looks).toBe(2);
    });

    it('does not wait for it to read or to remove a key', async () => {
      const sealKept = vi.fn(() => Promise.resolve(false));
      const { vault, kept } = aVault(aCipher({ sealKept }), someFiles(), { sealLimitMs: 60_000 });
      kept.set('alldebrid', aCipher().encrypt(KEY));

      expect(await vault.answer({ ...WRITE, action: 'read' })).toEqual({
        type: 'key',
        id: 1,
        ok: true,
        key: KEY,
      });
      expect(await vault.answer({ ...WRITE, action: 'remove' })).toEqual({
        type: 'key',
        id: 1,
        ok: true,
      });
      expect(sealKept).not.toHaveBeenCalled();
    });
  });

  describe('prepare', () => {
    it('has the system make what opens a key at the start, when it is not on disk yet', async () => {
      const encrypt = vi.fn(aCipher().encrypt);
      const { vault, kept, info } = aVault(
        aCipher({ encrypt, sealKept: () => Promise.resolve(false) }),
      );

      await vault.prepare();

      expect(encrypt).toHaveBeenCalledOnce();
      expect(kept.size).toBe(0);
      expect(info).toHaveBeenCalledWith('key_seal_prepared', {});
    });

    it('asks nothing of the system when it is on disk already, or where nothing can seal', async () => {
      const encrypt = vi.fn(aCipher().encrypt);
      const onDisk = aVault(aCipher({ encrypt }));
      const unprotected = aVault(
        aCipher({ encrypt, available: () => false, sealKept: () => Promise.resolve(false) }),
      );

      await onDisk.vault.prepare();
      await unprotected.vault.prepare();

      expect(encrypt).not.toHaveBeenCalled();
    });

    it('never fails the start: a system that refuses, or a look that fails, is a line in the log', async () => {
      const refusing = aVault(
        aCipher({
          sealKept: () => Promise.resolve(false),
          encrypt: () => {
            throw new Error('The system said no.');
          },
        }),
      );
      const blind = aVault(aCipher({ sealKept: () => Promise.reject(new Error('EACCES')) }));

      await refusing.vault.prepare();
      await blind.vault.prepare();

      expect(refusing.warn).toHaveBeenCalledWith('key_seal_not_prepared', expect.any(Object));
      expect(blind.warn).toHaveBeenCalledWith('key_seal_not_prepared', expect.any(Object));
    });
  });
});

describe('holdsSealingKey', () => {
  it('finds the key Chromium seals with in the profile’s Local State', () => {
    expect(holdsSealingKey('{"os_crypt":{"encrypted_key":"RFBBUEkBAAAA0Iyd3wEV0RG"}}')).toBe(true);
  });

  it('finds none in a Local State without it, with an empty one, or that does not parse', () => {
    for (const text of [
      '{}',
      '{"os_crypt":null}',
      '{"os_crypt":{}}',
      '{"os_crypt":{"encrypted_key":""}}',
      '{"os_crypt":{"encrypted_key":7}}',
      '{"os_crypt":{"encrypted_key":"RFBBUEk',
      'null',
      '',
    ]) {
      expect(holdsSealingKey(text), text).toBe(false);
    }
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
