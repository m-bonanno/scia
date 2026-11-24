import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_PREFIX, ApiErrorCode, MAX_URLS_PER_REQUEST } from '@scia/contracts';
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

  // The engine takes at most MAX_URLS_PER_REQUEST links in one request (#142): the page sends a
  // paste of more in batches, and "Download 201 files" adds 201 downloads.
  it('adds every link of a paste larger than one request holds', async () => {
    const profile = await run.profile();
    const host = run.keep(
      await startRangeServer({ body: randomBytes(64 * 1024), fileName: 'sample.bin' }),
    );
    const { page } = await run.launch(profile);
    const links = Array.from(
      { length: MAX_URLS_PER_REQUEST + 1 },
      (_, n) => `${host.url}?copy=${String(n)}`,
    );
    const field = page.getByRole('textbox', { name: 'Links to download' });

    await field.fill(links.join('\n'));
    await page.getByRole('button', { name: `Download ${String(links.length)} files` }).click();

    await until(async () => (await field.inputValue()) === '');
    const added = (await downloadsOf(page)).map((download) => download.url);
    expect([...added].sort()).toEqual([...links].sort());
    expect(await field.getAttribute('aria-invalid')).toBeNull();
  });

  // An answer the engine cannot be made to give, given in its place on the page's road
  // (docs/development/testing.md, "E2E"): no known cause makes it refuse what the page sends.
  it('says under the field what the engine did not take of the links sent from it', async () => {
    const profile = await run.profile();
    const { page } = await run.launch(profile);
    await page.route(`**${API_PREFIX}/downloads`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: ApiErrorCode.InvalidRequest, message: 'refused' } }),
      });
    });
    const field = page.getByRole('textbox', { name: 'Links to download' });

    await paste(page, 'http://127.0.0.1/a.zip');

    await until(async () => (await field.getAttribute('aria-invalid')) === 'true');
    const described = await field.evaluate(
      (element) =>
        document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent,
    );
    expect(described).toBe('Scia’s engine did not take these links.');
    expect(await field.inputValue()).toBe('http://127.0.0.1/a.zip');
    expect(await page.getByRole('list', { name: 'Notices' }).count()).toBe(0);
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
