import { randomBytes } from 'node:crypto';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { Page } from 'playwright-core';
import { DownloadStatus } from '@scia/core';
import { describe, expect, it } from 'vitest';
import { downloadsOf, paste, rowOf, until, useRun, type Run } from './scia.ts';
import { captureTo, viewportOf } from './under-notices.ts';

const MIB = 1024 * 1024;

// A host slow enough for a download to be seen running, and paused before it ends.
async function slowHost(run: Run, fileName: string, options: { ranges?: boolean } = {}) {
  return run.keep(
    await startRangeServer({
      body: randomBytes(32 * MIB),
      fileName,
      chunkBytes: 16 * 1024,
      chunkDelayMs: 200,
      ...options,
    }),
  );
}

// Pauses a download once some of it has arrived, so that its bar has a stretch to draw.
async function pauseOnceStarted(page: Page, fileName: string): Promise<void> {
  await until(async () =>
    (await downloadsOf(page)).some(
      (download) => download.fileName === fileName && download.downloadedBytes > 256 * 1024,
    ),
  );
  await rowOf(page, fileName).getByRole('button', { name: 'Pause' }).click();
  await rowOf(page, fileName).getByRole('button', { name: 'Resume' }).waitFor();
  await until(async () =>
    (await downloadsOf(page)).some(
      (download) => download.fileName === fileName && download.status === DownloadStatus.Paused,
    ),
  );
}

describe('a paused bar', () => {
  const run = useRun();

  // The bar's colour as the app draws it, against the token of the theme it wears: the token is
  // named for Tailwind in styles.css, and nothing else would show it missing (#58, #260).
  it.each(['dark', 'light'] as const)(
    'wears the theme’s paused tone in the %s variant',
    async (variant) => {
      const profile = await run.profile();
      const host = await slowHost(run, 'paused.bin');
      const scia = await run.launch(profile);
      const { page } = scia;
      await scia.app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, variant);
      await until(() =>
        page.evaluate((wanted) => matchMedia(`(prefers-color-scheme: ${wanted})`).matches, variant),
      );

      await paste(page, host.url);
      await pauseOnceStarted(page, 'paused.bin');

      const drawn = await rowOf(page, 'paused.bin').evaluate((row) => {
        const stretches = [...row.querySelectorAll<HTMLElement>('[role="progressbar"] > div')];
        const stretch = stretches.find((element) => element.getBoundingClientRect().width > 0);
        // The token as the page resolves it: the built stylesheet writes it in its shortest form
        // (`gray` for #808080), so it is read through an element that wears it.
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--paused)';
        document.body.append(probe);
        const token = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          fill: stretch === undefined ? null : getComputedStyle(stretch).backgroundColor,
          token,
        };
      });

      // Only this form is compared: a colour in another one (`oklab(…)`, a transparent `rgba`)
      // would be compared as something it is not (.claude/gotchas.md, #246).
      expect(drawn.token).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      expect(drawn.fill).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      expect(drawn.fill).toBe(drawn.token);
    },
  );

  // docs/design/downloads-paused.png, taken from the real app by CI (the owner, on #143): a paused
  // download beside running ones, a failed and a finished one, in the default theme's dark variant.
  it('takes the capture of a paused download beside the running ones', async () => {
    const profile = await run.profile();
    const film = await slowHost(run, 'Big Buck Bunny 1080p.mkv');
    const image = await slowHost(run, 'ubuntu-26.04-desktop-amd64.iso');
    const report = run.keep(
      await startRangeServer({ body: randomBytes(6 * MIB), fileName: 'Annual report 2026.pdf' }),
    );
    const photos = run.keep(await startRangeServer({ body: Buffer.alloc(0), status: 404 }));
    const concert = await slowHost(run, 'Live concert.flac', { ranges: false });
    const setup = await slowHost(run, 'old-setup.exe');
    const scia = await run.launch(profile);
    const { page } = scia;
    await scia.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'dark';
    });
    await viewportOf(page, 1040, 720);

    await paste(page, film.url);
    await paste(page, image.url);
    await pauseOnceStarted(page, 'ubuntu-26.04-desktop-amd64.iso');
    await paste(page, report.url);
    await rowOf(page, 'Annual report 2026.pdf')
      .getByRole('button', { name: 'Show in folder' })
      .waitFor({ timeout: 30_000 });
    // A refusal carries no name of the file: the row takes it from the address.
    await paste(page, photos.url.replace(/[^/]+$/, 'Holiday%20photos.zip'));
    await rowOf(page, 'Holiday photos.zip')
      .getByText('The file is no longer at this address.')
      .waitFor({ timeout: 30_000 });
    await paste(page, concert.url, setup.url);
    await until(async () =>
      (await downloadsOf(page)).every(
        (download) => download.status !== DownloadStatus.Downloading || download.bytesPerSecond > 0,
      ),
    );
    await until(async () => (await downloadsOf(page)).length === 6);

    // Nothing under the pointer, and nothing moving but the bars filling, before the capture.
    await page.mouse.move(1, 1);
    await until(() =>
      page.evaluate(
        () =>
          matchMedia('(prefers-color-scheme: dark)').matches &&
          document
            .getAnimations()
            .every(
              (animation) =>
                animation instanceof CSSTransition && animation.transitionProperty === 'width',
            ),
      ),
    );
    await page.screenshot({ path: await captureTo('downloads-paused.png') });
  });
});
