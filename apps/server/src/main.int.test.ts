import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageReaderOf } from './main.ts';
import { holdingFolder, recordingLogger, scratchFolder } from './testing/scratch.ts';
import { runsFolderOf } from './yt-dlp.ts';

const FAKE = join(import.meta.dirname, 'testing', 'fake-yt-dlp.mjs');

describe('the reader of pages, as the engine starts it', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  beforeEach(async () => {
    folder = await scratchFolder();
  });
  afterEach(async () => {
    await folder.remove();
  });

  // What a run of yt-dlp left in a folder of runs.
  const leftIn = async (runs: string, run: string) => {
    await mkdir(join(runs, run, '_MEI1'), { recursive: true });
    await writeFile(join(runs, run, '_MEI1', 'python.dll'), 'unpacked');
  };

  it('clears what its own runs left, never another profile’s, and logs what it cannot (#174)', async () => {
    const tempDir = join(folder.path, 'temp');
    const dataDir = join(folder.path, 'profile', 'engine');
    const ours = runsFolderOf(tempDir, dataDir);
    const theirs = runsFolderOf(tempDir, join(folder.path, 'another', 'engine'));
    await leftIn(ours, 'run-left');
    await leftIn(ours, 'run-held');
    await leftIn(theirs, 'run-reading');
    const logger = recordingLogger();
    const letGo = await holdingFolder(join(ours, 'run-held', '_MEI1'));
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
      expect(await readdir(ours)).toEqual(['run-held']);
      expect(await readdir(theirs)).toEqual(['run-reading']);
      expect(logger.lines.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual([
        'yt_dlp_run_not_removed',
      ]);
    } finally {
      await letGo();
    }
  }, 30_000);
});
