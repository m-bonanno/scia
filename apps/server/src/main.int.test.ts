import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageReaderOf } from './main.ts';
import { holdingFolder, recordingLogger, scratchFolder } from './testing/scratch.ts';
import { runPrefixOf } from './yt-dlp.ts';

const FAKE = join(import.meta.dirname, 'testing', 'fake-yt-dlp.mjs');

describe('the reader of pages, as the engine starts it', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  beforeEach(async () => {
    folder = await scratchFolder();
  });
  afterEach(async () => {
    await folder.remove();
  });

  // What a run of yt-dlp left in the temporary folder.
  const leftIn = async (tempDir: string, run: string) => {
    await mkdir(join(tempDir, run, '_MEI1'), { recursive: true });
    await writeFile(join(tempDir, run, '_MEI1', 'python.dll'), 'unpacked');
  };

  it('clears what its own runs left, never another profile’s, and logs what it cannot (#174)', async () => {
    const tempDir = join(folder.path, 'temp');
    const dataDir = join(folder.path, 'profile', 'engine');
    const ours = runPrefixOf(dataDir);
    const theirs = runPrefixOf(join(folder.path, 'another', 'engine'));
    await leftIn(tempDir, `${ours}left`);
    await leftIn(tempDir, `${ours}held`);
    await leftIn(tempDir, `${theirs}reading`);
    const logger = recordingLogger();
    const letGo = await holdingFolder(join(tempDir, `${ours}held`, '_MEI1'));
    try {
      const { pageReader } = await pageReaderOf(
        {
          ytDlp: FAKE,
          ytDlpUpdates: undefined,
          ytDlpReleases: 'http://127.0.0.1:9/',
          tempDir,
          dataDir,
          version: '0.0.0',
        },
        logger,
      );

      expect(pageReader).toBeDefined();
      expect((await readdir(tempDir)).sort()).toEqual([`${ours}held`, `${theirs}reading`].sort());
      expect(logger.lines.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual([
        'yt_dlp_run_not_removed',
      ]);
    } finally {
      await letGo();
    }
  }, 30_000);
});
