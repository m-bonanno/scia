import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStateStore, type PersistedState } from './state-store.ts';
import { scratchFolder } from './testing/scratch.ts';

async function markOn(path: string): Promise<unknown> {
  const saved = JSON.parse(await readFile(path, 'utf8')) as { settings: { mark: unknown } };
  return saved.settings.mark;
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
});
