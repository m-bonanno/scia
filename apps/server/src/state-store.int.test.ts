import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStateStore, type PersistedState } from './state-store.ts';
import { scratchFolder, until } from './testing/scratch.ts';

async function markOn(path: string): Promise<unknown> {
  const saved = JSON.parse(await readFile(path, 'utf8')) as { settings: { mark: unknown } };
  return saved.settings.mark;
}

// A state of the spec's own whose writes are counted: the store makes a state text once for each
// write. Its settings stay the object handed over, so that a change made after the save was asked
// for is what a write that starts later carries.
function counted(mark: number, writes: { count: number }): PersistedState {
  const state = { version: 1, settings: { mark }, downloads: [], magnets: [] };
  return {
    ...state,
    toJSON: () => {
      writes.count += 1;
      return state;
    },
  } as unknown as PersistedState;
}

function markOf(state: PersistedState): { mark: number } {
  return state.settings as unknown as { mark: number };
}

describe('JsonStateStore against a real folder', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  beforeEach(async () => {
    folder = await scratchFolder();
  });
  afterEach(async () => {
    await folder.remove();
  });

  // Windows refuses a rename onto an open file; Linux allows it, so the spec holds only there.
  it.runIf(process.platform === 'win32')(
    'lands a save whose rename the system refuses for a moment, as Windows does while another process holds the file (#151)',
    async () => {
      const path = join(folder.path, 'state.json');
      const store = new JsonStateStore(path);
      // The store writes what it is given: a state of the spec's own, told apart by its settings.
      const stateOf = (mark: number) =>
        ({
          version: 1,
          settings: { mark },
          downloads: [],
          magnets: [],
        }) as unknown as PersistedState;
      const before = stateOf(1);
      await store.save(before);

      // An antivirus or an indexer reading the file: on Windows a rename onto it fails meanwhile.
      const held = await open(path, 'r');
      const after = stateOf(2);
      const saving = store.save(after);
      setTimeout(() => void held.close(), 300);

      await saving;
      expect(await markOn(path)).toBe(2);
    },
  );

  it.runIf(process.platform === 'win32')(
    'gives a save up, as before, when the file stays held: the next change saves again',
    async () => {
      const path = join(folder.path, 'state.json');
      const store = new JsonStateStore(path);
      const stateOf = (mark: number) =>
        ({
          version: 1,
          settings: { mark },
          downloads: [],
          magnets: [],
        }) as unknown as PersistedState;
      await store.save(stateOf(1));
      const held = await open(path, 'r');
      try {
        await expect(store.save(stateOf(2))).rejects.toThrow(/EPERM|EACCES|EBUSY/);
      } finally {
        await held.close();
      }
      await store.save(stateOf(3));
      expect(await markOn(path)).toBe(3);
    },
    10_000,
  );

  it('makes one write for the saves that come while one is on its way, of the latest state as it is when that write starts (#63)', async () => {
    const path = join(folder.path, 'state.json');
    const store = new JsonStateStore(path);
    const writes = { count: 0 };
    const first = store.save(counted(0, writes));
    await until(() => writes.count === 1);

    const meanwhile = Array.from({ length: 100 }, (_, index) =>
      store.save(counted(index + 1, writes)),
    );
    const latest = counted(101, writes);
    const last = store.save(latest);
    // Changed after its save was asked for, before its write began: the write carries the change.
    markOf(latest).mark = 102;
    await Promise.all([first, ...meanwhile, last]);

    expect(writes.count).toBe(2);
    expect(await markOn(path)).toBe(102);
  });

  it('fails every save a failed write was to carry, and writes again at the next save (#63)', async () => {
    // A file where the folder of the state should be: no write can make it.
    const blocked = join(folder.path, 'data');
    await writeFile(blocked, '');
    const path = join(blocked, 'state.json');
    const store = new JsonStateStore(path);
    const writes = { count: 0 };
    const outcomeOf = (saving: Promise<void>) =>
      saving.then(
        () => 'landed',
        () => 'failed',
      );
    const first = outcomeOf(store.save(counted(1, writes)));
    await until(() => writes.count === 1);
    const meanwhile = [
      outcomeOf(store.save(counted(2, writes))),
      outcomeOf(store.save(counted(3, writes))),
    ];

    expect(await Promise.all([first, ...meanwhile])).toEqual(['failed', 'failed', 'failed']);
    expect(writes.count).toBe(2);
    await rm(blocked);
    await store.save(counted(4, writes));
    expect(await markOn(path)).toBe(4);
  });

  // Windows refuses a rename onto an open file; Linux allows it, so the spec holds only there.
  it.runIf(process.platform === 'win32')(
    'keeps only the latest state waiting while the file is held, and lands it once the file is free (#63, #151)',
    async () => {
      const path = join(folder.path, 'state.json');
      const store = new JsonStateStore(path);
      const writes = { count: 0 };
      await store.save(counted(0, writes));
      const held = await open(path, 'r');
      const first = store.save(counted(1, writes));
      await until(() => writes.count === 2);

      const meanwhile = Array.from({ length: 50 }, (_, index) =>
        store.save(counted(index + 2, writes)),
      );
      setTimeout(() => void held.close(), 300);
      await Promise.all([first, ...meanwhile]);

      expect(writes.count).toBe(3);
      expect(await markOn(path)).toBe(51);
    },
    10_000,
  );
});
