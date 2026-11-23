import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadStatus } from '@scia/core';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import { sparseFlagOf } from '@scia/server/testing/scratch.ts';
import { describe, expect, it } from 'vitest';
import { downloadsOf, paste, rowOf, until, useRun } from './scia.ts';

describe('the real app downloads', () => {
  const run = useRun();

  it('starts, and its engine serves the page on the port it took', async () => {
    const profile = await run.profile();

    const scia = await run.launch(profile);

    const log = await profile.log();
    expect(log).toContain('engine_ready');
    expect(log).not.toMatch(/\[error\]/);
    expect(scia.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('fetches a pasted link over several connections, byte for byte', async () => {
    const profile = await run.profile();
    const body = randomBytes(8 * 1024 * 1024);
    const host = run.keep(await startRangeServer({ body, fileName: 'sample.bin' }));
    const scia = await run.launch(profile);

    await paste(scia.page, host.url);

    await rowOf(scia.page, 'sample.bin')
      .getByRole('button', { name: 'Show in folder' })
      .waitFor({ timeout: 30_000 });
    const written = await readFile(join(profile.downloads, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
    // Besides the probe of the first byte, the host was asked for more than one range.
    const ranges = host.ranges.filter((range) => range !== undefined && range !== 'bytes=0-0');
    expect(ranges.length).toBeGreaterThan(1);
  });

  it('takes every completed download off the list at the second press of "Clear completed", keeping the files (#215)', async () => {
    const profile = await run.profile();
    const first = randomBytes(1024 * 1024);
    const second = randomBytes(1024 * 1024);
    const one = run.keep(await startRangeServer({ body: first, fileName: 'one.bin' }));
    const two = run.keep(await startRangeServer({ body: second, fileName: 'two.bin' }));
    // Slow enough to be paused while it runs.
    const slow = run.keep(
      await startRangeServer({
        body: randomBytes(8 * 1024 * 1024),
        fileName: 'slow.bin',
        chunkBytes: 16 * 1024,
        chunkDelayMs: 40,
      }),
    );
    const { page } = await run.launch(profile);
    await paste(page, one.url, two.url, slow.url);
    await until(async () =>
      (await downloadsOf(page)).some(
        (download) => download.fileName === 'slow.bin' && download.downloadedBytes > 0,
      ),
    );
    await rowOf(page, 'slow.bin').getByRole('button', { name: 'Pause' }).click();
    await until(async () => {
      const statuses = (await downloadsOf(page)).map((download) => download.status).sort();
      return (
        JSON.stringify(statuses) ===
        JSON.stringify(
          [DownloadStatus.Completed, DownloadStatus.Completed, DownloadStatus.Paused].sort(),
        )
      );
    });

    const clear = page.getByRole('button', { name: 'Clear completed' });
    await clear.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Clear 2 completed' }).waitFor();
    expect((await downloadsOf(page)).length).toBe(3);
    await page.keyboard.press('Enter');

    await page.getByRole('button', { name: /^Clear/ }).waitFor({ state: 'detached' });
    const left = await downloadsOf(page);
    expect(left.map((download) => [download.fileName, download.status])).toEqual([
      ['slow.bin', DownloadStatus.Paused],
    ]);
    await rowOf(page, 'one.bin').waitFor({ state: 'detached' });
    expect(await rowOf(page, 'slow.bin').count()).toBe(1);
    expect(Buffer.compare(await readFile(join(profile.downloads, 'one.bin')), first)).toBe(0);
    expect(Buffer.compare(await readFile(join(profile.downloads, 'two.bin')), second)).toBe(0);
    // The focus it held goes to the filter in use, beside it.
    expect(
      await page
        .getByRole('button', { name: /^All/ })
        .evaluate((tab) => tab === document.activeElement),
    ).toBe(true);
  });

  it.runIf(process.platform === 'win32')(
    "makes the part file of a download sparse with the system's own fsutil, so that a large file starts at once (#182)",
    async () => {
      const profile = await run.profile();
      const body = randomBytes(4 * 1024 * 1024);
      // Slow enough that the download is still running when it is paused.
      const host = run.keep(
        await startRangeServer({
          body,
          fileName: 'sample.bin',
          chunkBytes: 16 * 1024,
          chunkDelayMs: 40,
        }),
      );
      const scia = await run.launch(profile);
      await paste(scia.page, host.url);
      await until(async () =>
        (await downloadsOf(scia.page)).some((download) => download.downloadedBytes > 0),
      );

      await rowOf(scia.page, 'sample.bin').getByRole('button', { name: 'Pause' }).click();
      await until(async () =>
        (await downloadsOf(scia.page)).every(
          (download) => download.status === DownloadStatus.Paused,
        ),
      );

      // fsutil answers in the system's words: the part file's answer is told from a dense file's.
      const dense = join(profile.path, 'dense.bin');
      await writeFile(dense, body);
      expect(sparseFlagOf(join(profile.downloads, 'sample.bin.scia'))).not.toBe(
        sparseFlagOf(dense),
      );
      expect(await profile.log()).not.toContain('part_file_not_sparse');
    },
  );
});
