import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadStatus } from '@scia/core';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { downloadsOf, paste, type Profile, rowOf, until, useRun } from './scia.ts';
import { captureTo, viewportOf } from './under-notices.ts';

const MIB = 1024 * 1024;
// What a site may call its video: markup and all, which is text to the row (#285).
const TITLE = 'Big Buck Bunny <b>4K</b> | Blender Open Movie';
const WATCH = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

// Ready rows as the engine keeps them once a video's title was read (#285). The read itself asks a
// site: the built app reads no page of a real site in a spec, and its title is read by the engine's
// specs against a stand-in for yt-dlp. Nothing here is started, so no address here is asked.
async function readyRows(
  profile: Profile,
  rows: readonly { url: string; fileName: string; title: string | null }[],
): Promise<void> {
  await mkdir(join(profile.path, 'engine'), { recursive: true });
  await writeFile(
    join(profile.path, 'engine', 'state.json'),
    JSON.stringify({
      version: 1,
      settings: {
        maxConcurrentDownloads: 3,
        connectionsPerDownload: 8,
        downloadDirectory: profile.downloads,
      },
      downloads: rows.map((row, index) => ({
        id: `ready-${String(index)}`,
        url: row.url,
        referrer: null,
        directory: profile.downloads,
        fileName: row.fileName,
        title: row.title,
        named: false,
        status: DownloadStatus.Ready,
        totalBytes: null,
        resumable: false,
        validator: null,
        segments: [],
        downloadedBytes: 0,
        failure: null,
        failureStatus: null,
        via: null,
        unlockedUrl: null,
        video: null,
        fromPage: false,
        timeline: null,
        nameKept: false,
        createdAt: `2026-11-23T10:00:0${String(index)}.000Z`,
        completedAt: null,
      })),
    }),
  );
}

async function settled(page: Page, variant: 'dark' | 'light'): Promise<void> {
  await page.mouse.move(1, 1);
  await until(() =>
    page.evaluate(
      (wanted) =>
        matchMedia(`(prefers-color-scheme: ${wanted})`).matches &&
        document
          .getAnimations()
          .every(
            (animation) =>
              animation instanceof CSSTransition && animation.transitionProperty === 'width',
          ),
      variant,
    ),
  );
}

describe('the ready row of a video’s page, in the real app (#285)', () => {
  const run = useRun();

  it('names it by the title its site gives, as text, and by its address while it has none', async () => {
    const profile = await run.profile();
    await readyRows(profile, [
      { url: WATCH, fileName: 'watch', title: TITLE },
      { url: 'https://www.youtube.com/watch?v=YE7VzlLtp-4', fileName: 'watch', title: null },
    ]);
    const { page } = await run.launch(profile);

    const titled = rowOf(page, TITLE);
    await titled.waitFor();
    // Markup a site writes is text: the row holds no element it named.
    expect(await titled.locator('p').first().textContent()).toBe(TITLE);
    expect(await titled.locator('b').count()).toBe(0);
    expect(await titled.getByRole('button', { name: 'Start' }).isVisible()).toBe(true);
    // A row whose title has not come, or never will, keeps its address.
    await rowOf(page, 'youtube.com/watch?v=YE7VzlLtp-4').waitFor();
    expect((await downloadsOf(page)).map((download) => download.title)).toEqual([TITLE, null]);
  });

  // docs/design/ready-links.png and its light variant, taken from the real app by CI: a video's page
  // by its title, a program and a PDF "Ready", beside a running download, "Start all" beside the
  // filters.
  it('takes the captures of ready links beside a running download', async () => {
    const profile = await run.profile();
    const film = run.keep(
      await startRangeServer({
        body: randomBytes(64 * MIB),
        fileName: 'Holiday.mkv',
        chunkBytes: 32 * 1024,
        chunkDelayMs: 200,
      }),
    );
    // Local addresses: nothing is started, and a Start would ask this computer alone. The list
    // shows the newest first: the video's page, copied last, under the download pasted now.
    const at = (name: string) => film.url.replace(/[^/]+$/, name);
    await readyRows(profile, [
      { url: at('Report%202026.pdf'), fileName: 'Report 2026.pdf', title: null },
      { url: at('setup-2.4.1.exe'), fileName: 'setup-2.4.1.exe', title: null },
      {
        url: WATCH,
        fileName: 'watch',
        title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film',
      },
    ]);
    const scia = await run.launch(profile);
    const { page } = scia;
    await viewportOf(page, 1040, 720);

    await paste(page, film.url);
    await until(async () =>
      (await downloadsOf(page)).some(
        (download) =>
          download.fileName === 'Holiday.mkv' &&
          download.totalBytes !== null &&
          download.downloadedBytes >= download.totalBytes * 0.2,
      ),
    );
    await page.getByRole('button', { name: 'Start all' }).waitFor();

    for (const [variant, name] of [
      ['dark', 'ready-links.png'],
      ['light', 'ready-links-light.png'],
    ] as const) {
      await scia.app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, variant);
      await settled(page, variant);
      await page.screenshot({ path: await captureTo(name) });
    }
  });
});
