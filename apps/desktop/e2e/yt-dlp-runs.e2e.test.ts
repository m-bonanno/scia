import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import { holdingFolder } from '@scia/server/testing/scratch.ts';
import { runPrefixOf } from '@scia/server/testing/yt-dlp-runs.ts';
import { describe, expect, it } from 'vitest';
import { YT_DLP_OF_PLATFORM } from '../src/engine/runtime-layout.ts';
import { paste, rowOf, useRun } from './scia.ts';

// The yt-dlp `npm start` and CI's E2E job fetch for this computer (scripts/fetch-tools.ts): with
// none, the engine reads no page, and has no runs' folders to look at.
const TOOL = YT_DLP_OF_PLATFORM[process.platform];
const SHIPPED = resolve(import.meta.dirname, '..', 'tools', TOOL?.os ?? '', TOOL?.file ?? '');

describe('what yt-dlp’s runs left, as the real app starts (#174)', () => {
  const run = useRun();

  it('removes the folders its runs left before, and starts and downloads when one cannot be removed', async () => {
    expect(
      existsSync(SHIPPED),
      `No yt-dlp at ${SHIPPED}: run node apps/desktop/scripts/fetch-tools.ts first.`,
    ).toBe(true);
    const profile = await run.profile();
    // Where main has the engine keep its data and its runs' folders, as main names them.
    const first = await run.launch(profile);
    const userData = await first.app.evaluate(({ app }) => app.getPath('userData'));
    const temp = await first.app.evaluate(({ app }) => app.getPath('temp'));
    await first.quit();
    const prefix = runPrefixOf(join(userData, 'engine'));
    const left = join(temp, `${prefix}left`);
    const held = join(temp, `${prefix}held`);
    for (const folder of [left, held]) {
      await mkdir(join(folder, '_MEI1'), { recursive: true });
      await writeFile(join(folder, '_MEI1', 'python.dll'), 'unpacked');
    }
    const letGo = await holdingFolder(join(held, '_MEI1'));
    try {
      const body = randomBytes(1024 * 1024);
      const host = run.keep(await startRangeServer({ body, fileName: 'after.bin' }));

      const scia = await run.launch(profile);
      await paste(scia.page, host.url);

      await rowOf(scia.page, 'after.bin')
        .getByRole('button', { name: 'Show in folder' })
        .waitFor({ timeout: 30_000 });
      expect(Buffer.compare(await readFile(join(profile.downloads, 'after.bin')), body)).toBe(0);
      expect(existsSync(left)).toBe(false);
      expect(existsSync(held)).toBe(true);
    } finally {
      await letGo();
      for (const folder of [left, held]) {
        await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });
});
