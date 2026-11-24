import { open, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Theme } from '@scia/contracts/theme';
import { scratchFolder, until } from '@scia/server/testing/scratch.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RememberedTheme } from './engine/remembered-theme.ts';
import { ShownNotices } from './engine/shown-notices.ts';
import { JsonFile } from './json-file.ts';

// Main's files of the profile, written on a real disk.
describe('JsonFile against a real folder', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let lines: [string, string, object][];
  const log = {
    info: (message: string, details: object) => lines.push(['info', message, details]),
    warn: (message: string, details: object) => lines.push(['warn', message, details]),
  };
  // What Windows refuses a rename onto a file another program holds with.
  const held = expect.stringMatching(/^E(PERM|ACCES|BUSY)$/) as unknown;
  const onDisk = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(join(folder.path, name), 'utf8'));

  beforeEach(async () => {
    folder = await scratchFolder();
    lines = [];
  });
  afterEach(async () => {
    await folder.remove();
  });

  it('reads back whole what it wrote, in a folder it made, with nothing left beside it', async () => {
    const file = new JsonFile(join(folder.path, 'Scia', 'theme.json'));
    expect(await file.read()).toBeUndefined();

    await file.write({ theme: Theme.Ice });

    expect(await file.read()).toEqual({ theme: Theme.Ice });
    expect(await readdir(join(folder.path, 'Scia'))).toEqual(['theme.json']);
  });

  // Windows refuses a rename onto a file another process has open; Linux allows it, so the specs
  // below hold only there.
  it.runIf(process.platform === 'win32')(
    'lands a write whose rename the system refuses for a moment, as Windows does while an antivirus reads the file (#307)',
    async () => {
      const path = join(folder.path, 'theme.json');
      const file = new JsonFile(path);
      await file.write({ theme: Theme.Brick });

      const reader = await open(path, 'r');
      const startedAt = performance.now();
      setTimeout(() => void reader.close(), 300);
      await file.write({ theme: Theme.Ice });
      const tookMs = performance.now() - startedAt;

      expect(await onDisk('theme.json')).toEqual({ theme: Theme.Ice });
      // The premise: the system refused the rename while the file was held. A write that landed at
      // once would hold nothing of the retry.
      expect(tookMs, `the write took ${String(Math.round(tookMs))} ms`).toBeGreaterThanOrEqual(250);
    },
  );

  it.runIf(process.platform === 'win32')(
    'gives the theme’s write up when the file stays held, says so, and lands the next one',
    async () => {
      const path = join(folder.path, 'theme.json');
      const theme = new RememberedTheme(new JsonFile(path), log);
      await theme.keep(Theme.Brick);
      lines = [];

      const reader = await open(path, 'r');
      try {
        await theme.keep(Theme.Ice);
      } finally {
        await reader.close();
      }

      expect(lines).toEqual([['warn', 'theme_not_kept', { theme: Theme.Ice, code: held }]]);
      expect(await onDisk('theme.json')).toEqual({ theme: Theme.Brick });
      await theme.keep(Theme.Ice);
      expect(await onDisk('theme.json')).toEqual({ theme: Theme.Ice });
    },
  );

  it.runIf(process.platform === 'win32')(
    'gives a notice’s write up when the file stays held, says so, and keeps it at the next launch',
    async () => {
      const path = join(folder.path, 'notices.json');
      await writeFile(path, JSON.stringify(['first']));
      const notices = new ShownNotices(new JsonFile(path), log);

      const reader = await open(path, 'r');
      try {
        // Answered at once: the write goes on behind, and says how it ended.
        expect(await notices.firstTime('hidden-to-tray')).toBe(true);
        await until(() => lines.length > 0);
      } finally {
        await reader.close();
      }

      expect(lines).toEqual([
        ['warn', 'notices_not_kept', { notice: 'hidden-to-tray', code: held }],
      ]);
      expect(await onDisk('notices.json')).toEqual(['first']);
      lines = [];
      const next = new ShownNotices(new JsonFile(path), log);
      expect(await next.firstTime('hidden-to-tray')).toBe(true);
      await until(() => lines.length > 0);
      expect(lines).toEqual([['info', 'notices_kept', { notice: 'hidden-to-tray' }]]);
      expect(await onDisk('notices.json')).toEqual(['first', 'hidden-to-tray']);
    },
  );
});
