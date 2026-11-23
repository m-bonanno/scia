import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startAllDebridServer } from '@scia/server/testing/alldebrid-server.ts';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import { API_PREFIX, ApiErrorCode } from '@scia/contracts';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { allCompleted, downloadsOf, paste, rowOf, type Scia, until, useRun } from './scia.ts';
import {
  bottomOf,
  captureTo,
  placeUnderNotices,
  roomAround,
  scrollsAround,
  scrollToEnd,
  topOfNotices,
  viewportOf,
} from './under-notices.ts';

const KIB = 1024;
const MIB = 1024 * KIB;
// Made up, as every key and every hash of a spec.
const KEY = 'e2e-made-up-key-0123456789';
const PREMIUM_UNTIL = 4_102_444_800;
const HASH = '842783e3005495d5d1637f5364b59343c7844707';

describe('the real app, with a magnet', () => {
  const run = useRun();

  it('sends a pasted magnet to a connected AllDebrid, and downloads its files in its folder and theirs', async () => {
    const profile = await run.profile();
    const film = randomBytes(512 * KIB);
    const notes = randomBytes(3 * KIB);
    const filmHost = run.keep(await startRangeServer({ body: film }));
    const notesHost = run.keep(await startRangeServer({ body: notes }));
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
        hosts: { alldebrid: ['alldebrid.com'] },
        links: {
          'https://alldebrid.com/f/film': { direct: filmHost.url, filename: 'film.mkv' },
          'https://alldebrid.com/f/notes': { direct: notesHost.url, filename: 'notes.nfo' },
        },
        magnets: {
          [HASH]: {
            name: 'Holiday films',
            size: film.length + notes.length,
            fetchingPolls: 1,
            files: [
              { n: 'film.mkv', s: film.length, l: 'https://alldebrid.com/f/film' },
              {
                n: 'Extras',
                e: [{ n: 'notes.nfo', s: notes.length, l: 'https://alldebrid.com/f/notes' }],
              },
            ],
          },
        },
      }),
    );
    const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
    const { page } = scia;
    const field = page.getByRole('textbox', { name: 'Links to download' });
    // The field names magnets only while a service is connected (#150).
    expect(await field.getAttribute('placeholder')).toBe('Paste one or more links');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Use an API key' }).click();
    await page.getByLabel('AllDebrid API key').fill(KEY);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    await until(async () => (await field.getAttribute('placeholder')) === 'Paste links or magnets');

    await paste(page, `magnet:?xt=urn:btih:${HASH}&dn=Holiday%20films`);

    // The magnet's row while AllDebrid fetches it; then its files, and no magnet.
    await page.getByRole('listitem').filter({ hasText: 'Holiday films' }).waitFor();
    await until(() => allCompleted(page), 60_000);
    await page.getByTitle('Holiday films', { exact: true }).waitFor({ state: 'detached' });
    const root = join(profile.downloads, 'Holiday films');
    expect(Buffer.compare(await readFile(join(root, 'film.mkv')), film)).toBe(0);
    expect(Buffer.compare(await readFile(join(root, 'Extras', 'notes.nfo')), notes)).toBe(0);
    // The magnet reached the service, and nowhere a person reads.
    expect(service.requests.some((request) => request.url === '/v4/magnet/upload')).toBe(true);
    expect(await profile.log()).not.toContain(HASH);
  });

  it("lists the account's magnets in a panel only while it is open, and downloads one added elsewhere (#138)", async () => {
    const profile = await run.profile();
    const film = randomBytes(256 * KIB);
    const filmHost = run.keep(await startRangeServer({ body: film }));
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
        hosts: { alldebrid: ['alldebrid.com'] },
        links: { 'https://alldebrid.com/f/film': { direct: filmHost.url, filename: 'film.mkv' } },
        magnets: {
          [HASH]: {
            name: 'Concert',
            size: film.length,
            files: [{ n: 'film.mkv', s: film.length, l: 'https://alldebrid.com/f/film' }],
          },
        },
        onTheAccount: [HASH],
      }),
    );
    const statusAsked = () =>
      service.requests.filter((request) => request.url === '/v4.1/magnet/status').length;
    const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
    const { page } = scia;
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Use an API key' }).click();
    await page.getByLabel('AllDebrid API key').fill(KEY);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    const toggle = page.getByRole('button', { name: 'AllDebrid magnets' });
    // Offered once connected, closed: nothing of the account is asked.
    await toggle.waitFor();
    expect(statusAsked()).toBe(0);

    await toggle.click();
    const panel = page.getByRole('complementary', { name: 'AllDebrid magnets' });
    await panel.getByText('Concert').waitFor();
    // Its status region says nothing now, and stays in the accessibility tree for what it says next.
    const status = panel.getByRole('status');
    expect(await status.textContent()).toBe('');
    expect(await status.evaluate((region) => getComputedStyle(region).display)).not.toBe('none');
    await panel.getByRole('button', { name: 'Download Concert' }).click();

    await until(() => allCompleted(page), 60_000);
    // A magnet of one file: straight into the download folder, with no folder of its own (#150).
    expect(await readdir(profile.downloads)).toEqual(['film.mkv']);
    expect(Buffer.compare(await readFile(join(profile.downloads, 'film.mkv')), film)).toBe(0);
    expect(service.requests.some((request) => request.url === '/v4/magnet/upload')).toBe(false);
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'AllDebrid magnets',
    );
    // Closed, and no magnet of Scia's waiting: the account is asked no more — open, it was asked
    // every five seconds.
    const asked = statusAsked();
    await expect(until(() => statusAsked() > asked, 7000)).rejects.toThrow();
  });

  // WCAG 2.2, 2.4.11 (#143): the panel scrolls beneath the notices as the list does.
  it('leaves room under the last magnet of the panel, and keeps a focus clear of the notices', async () => {
    const profile = await run.profile();
    // Made up, as every hash of a spec: magnets enough for the panel to scroll.
    const hashes = Array.from({ length: 16 }, (_, n) => String(n).padStart(40, '0'));
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
        magnets: Object.fromEntries(
          hashes.map((hash, n) => [
            hash,
            {
              name: `Album ${String(n + 1)}`,
              size: KIB,
              files: [{ n: 'track.flac', s: KIB, l: `https://alldebrid.com/f/${hash}` }],
            },
          ]),
        ),
        onTheAccount: hashes,
      }),
    );
    const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
    const { page } = scia;
    await scia.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(800, 560);
    });
    await until(() => page.evaluate(() => window.innerHeight === 560));
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Use an API key' }).click();
    await page.getByLabel('AllDebrid API key').fill(KEY);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'AllDebrid magnets' }).click();
    const panel = page.getByRole('complementary', { name: 'AllDebrid magnets' });
    const rows = panel.getByRole('listitem');
    await until(async () => (await rows.count()) === hashes.length);
    const lastRow = rows.last();
    expect(await scrollsAround(lastRow)).toBe(true);
    // A notice: an add the engine refuses.
    await page.route(`**${API_PREFIX}/downloads`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: ApiErrorCode.InternalError, message: 'refused' } }),
      });
    });

    // The field's own button: the panel's "Download <name>" buttons share its first word.
    await page
      .getByRole('textbox', { name: 'Links to download' })
      .fill('https://example.com/a.zip');
    await page
      .getByRole('main')
      .getByRole('button', { name: /^Download/ })
      .click();
    await page.getByRole('list', { name: 'Notices' }).getByRole('listitem').waitFor();
    await until(async () => (await roomAround(lastRow)) > 0);
    const download = lastRow.getByRole('button', { name: /^Download / });

    expect(await placeUnderNotices(download)).toBeGreaterThan(await topOfNotices(page));
    await download.focus();
    expect(await bottomOf(download)).toBeLessThanOrEqual(await topOfNotices(page));
    await scrollToEnd(lastRow);
    expect(await bottomOf(lastRow)).toBeLessThanOrEqual(await topOfNotices(page));
  });

  // The captures of docs/design/ that show the field while AllDebrid is connected, taken again
  // from the real app by CI once the field named magnets (#150; the owner, on #143).
  describe('takes the captures', () => {
    async function connect(page: Page): Promise<void> {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('button', { name: 'Use an API key' }).click();
      await page.getByLabel('AllDebrid API key').fill(KEY);
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await page.getByRole('button', { name: 'Disconnect' }).waitFor();
      await page.getByRole('button', { name: 'Close' }).click();
      await until(
        async () =>
          (await page
            .getByRole('textbox', { name: 'Links to download' })
            .getAttribute('placeholder')) === 'Paste links or magnets',
      );
    }

    // The system's clipboard answered in main, as clipboard.e2e does: empty at first, then what a
    // spec copies. A spec never takes a person's clipboard.
    async function answerClipboard({ app }: Scia): Promise<void> {
      await app.evaluate(({ clipboard }) => {
        const copied = globalThis as { sciaCopied?: string };
        clipboard.readText = () => Promise.resolve(copied.sciaCopied ?? '');
        clipboard.has = (format) =>
          Promise.resolve(format === 'text/plain' && (copied.sciaCopied ?? '') !== '');
      });
    }
    async function copy({ app }: Scia, text: string): Promise<void> {
      await app.evaluate((_electron, copied) => {
        (globalThis as { sciaCopied?: string }).sciaCopied = copied;
      }, text);
    }

    // Nothing under the pointer, and nothing moving but `moving` bars filling, in the variant asked.
    async function capture(
      scia: Scia,
      variant: 'dark' | 'light',
      name: string,
      moving = false,
    ): Promise<void> {
      const { app, page } = scia;
      await app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, variant);
      await page.mouse.move(1, 1);
      await until(() =>
        page.evaluate(
          ([wanted, bars]) =>
            matchMedia(`(prefers-color-scheme: ${wanted})`).matches &&
            document
              .getAnimations()
              .every(
                (animation) =>
                  bars &&
                  animation instanceof CSSTransition &&
                  animation.transitionProperty === 'width',
              ),
          [variant, moving] as const,
        ),
      );
      await page.screenshot({ path: await captureTo(name) });
    }

    it('of a magnet AllDebrid fetches, and of links that went through it', async () => {
      const profile = await run.profile();
      const bunny = run.keep(
        await startRangeServer({
          body: randomBytes(96 * MIB),
          fileName: 'Big Buck Bunny.mkv',
          chunkBytes: 32 * KIB,
          chunkDelayMs: 200,
        }),
      );
      const notes = run.keep(
        await startRangeServer({ body: randomBytes(3 * MIB), fileName: 'notes.pdf' }),
      );
      const direct = run.keep(
        await startRangeServer({ body: randomBytes(2 * MIB), fileName: 'direct.zip' }),
      );
      const service = run.keep(
        await startAllDebridServer({
          accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
          hosts: { alldebrid: ['alldebrid.com'] },
          links: {
            'https://alldebrid.com/f/bunny': { direct: bunny.url, filename: 'Big Buck Bunny.mkv' },
            'https://alldebrid.com/f/notes': { direct: notes.url, filename: 'notes.pdf' },
            'https://alldebrid.com/f/limit': { error: 'LINK_HOST_LIMIT_REACHED' },
            'https://alldebrid.com/f/gone': { error: 'LINK_DOWN' },
          },
          magnets: {
            [HASH]: { name: 'Holiday films', size: 24 * MIB, fetchingPolls: 1e6, files: [] },
          },
        }),
      );
      const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
      const { page } = scia;
      await connect(page);

      await viewportOf(page, 1040, 520);
      await paste(page, `magnet:?xt=urn:btih:${HASH}&dn=Holiday%20films`);
      const magnet = page.getByRole('listitem').filter({ hasText: 'Holiday films' });
      await magnet.getByText(/1\.0\sMB\/s/).waitFor();
      await capture(scia, 'dark', 'a-magnet.png');
      await capture(scia, 'light', 'a-magnet-light.png');
      await magnet.getByRole('button', { name: /^Remove/ }).click();
      await magnet.waitFor({ state: 'detached' });

      // Newest first: pasted from the bottom of the capture up.
      await viewportOf(page, 1040, 720);
      await paste(page, 'https://alldebrid.com/f/notes');
      await rowOf(page, 'notes.pdf').getByRole('button', { name: 'Show in folder' }).waitFor();
      await paste(page, 'https://alldebrid.com/f/gone');
      await rowOf(page, 'gone').getByText('says the file is no longer on its host').waitFor();
      await paste(page, 'https://alldebrid.com/f/limit');
      await rowOf(page, 'limit').getByText('has reached its limit for this host').waitFor();
      await paste(page, direct.url);
      await rowOf(page, 'direct.zip').getByRole('button', { name: 'Show in folder' }).waitFor();
      await paste(page, 'https://alldebrid.com/f/bunny');
      await until(async () =>
        (await downloadsOf(page)).some(
          (download) =>
            download.fileName === 'Big Buck Bunny.mkv' &&
            download.totalBytes !== null &&
            download.downloadedBytes >= download.totalBytes * 0.15,
        ),
      );
      await capture(scia, 'dark', 'via-a-service.png', true);
    });

    it('of Settings with AllDebrid connected', async () => {
      const profile = await run.profile();
      const service = run.keep(
        await startAllDebridServer({
          accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
        }),
      );
      const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
      const { page } = scia;
      await answerClipboard(scia);
      await connect(page);
      await viewportOf(page, 1040, 900);

      const settings = page.getByRole('dialog', { name: 'Settings' });
      await page.getByRole('button', { name: 'Settings' }).click();
      const watch = settings.getByRole('switch', { name: 'Take links from the clipboard' });
      await watch.click();
      await until(() => watch.isChecked());
      await settings.getByText('Connected as ada').waitFor();
      await capture(scia, 'dark', 'settings.png');
      await capture(scia, 'light', 'settings-light.png');
    });

    it("of the panel of the account's magnets, beside the list and at its narrowest", async () => {
      const profile = await run.profile();
      const video = run.keep(
        await startRangeServer({
          body: randomBytes(64 * MIB),
          fileName: 'holiday-video.mp4',
          chunkBytes: 32 * KIB,
          chunkDelayMs: 200,
        }),
      );
      const setup = run.keep(await startRangeServer({ body: randomBytes(KIB) }));
      const [lecture, holiday, concert] = ['c', 'd', 'e'].map((digit) => digit.repeat(40));
      const service = run.keep(
        await startAllDebridServer({
          accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
          hosts: { alldebrid: ['alldebrid.com'] },
          links: { 'https://alldebrid.com/f/lecture.zip': { error: 'LINK_PASS_PROTECTED' } },
          magnets: {
            [lecture ?? '']: {
              name: 'Lecture notes',
              size: MIB,
              fails: true,
              files: [],
              uploadDate: 1_700_000_300,
            },
            [holiday ?? '']: {
              name: 'Holiday films',
              size: 24 * MIB,
              fetchingPolls: 1e6,
              files: [],
              uploadDate: 1_700_000_200,
            },
            [concert ?? '']: {
              name: 'Concert in the park',
              size: 8 * MIB,
              files: [{ n: 'concert.flac', s: 8 * MIB, l: 'https://alldebrid.com/f/concert' }],
              uploadDate: 1_700_000_100,
            },
          },
          onTheAccount: [lecture ?? '', holiday ?? '', concert ?? ''],
        }),
      );
      const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
      const { page } = scia;
      await answerClipboard(scia);
      await connect(page);
      const toggle = page.getByRole('button', { name: 'AllDebrid magnets' });
      const panel = page.getByRole('complementary', { name: 'AllDebrid magnets' });
      const shown = async () => {
        await toggle.press('Enter');
        await panel.getByRole('button', { name: 'Download Concert in the park' }).waitFor();
        await panel.getByText(/1\.0\sMB\/s/).waitFor();
        await panel.getByText('gave no files for it').waitFor();
      };

      await viewportOf(page, 1040, 520);
      await shown();
      await capture(scia, 'dark', 'the-account-magnets.png');
      await capture(scia, 'light', 'the-account-magnets-light.png');
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });

      // Beside a list: a running download, a magnet AllDebrid fetches, a ready row and a failure
      // in full, newest first.
      await paste(page, video.url);
      await until(async () =>
        (await downloadsOf(page)).some(
          (download) =>
            download.fileName === 'holiday-video.mp4' &&
            download.totalBytes !== null &&
            download.downloadedBytes >= download.totalBytes * 0.15,
        ),
      );
      await paste(page, 'https://alldebrid.com/f/lecture.zip');
      await rowOf(page, 'lecture.zip').getByText('asks for a password').waitFor();
      await page.getByRole('button', { name: 'Settings' }).click();
      const watch = page.getByRole('switch', { name: 'Take links from the clipboard' });
      await watch.click();
      await until(() => watch.isChecked());
      await page.getByRole('button', { name: 'Close' }).click();
      await copy(scia, setup.url.replace('sample.bin', 'setup.exe'));
      await rowOf(page, 'setup.exe').getByRole('button', { name: 'Start' }).waitFor();
      await paste(page, `magnet:?xt=urn:btih:${holiday ?? ''}&dn=Holiday%20films`);
      await page
        .getByRole('main')
        .getByRole('listitem')
        .filter({ hasText: 'Holiday films' })
        .getByText(/1\.0\sMB\/s/)
        .waitFor();
      await viewportOf(page, 640, 720);
      await shown();
      await capture(scia, 'dark', 'the-account-magnets-narrow.png', true);
      await capture(scia, 'light', 'the-account-magnets-narrow-light.png', true);
    });

    it('of a failure that says more than a line holds', async () => {
      const profile = await run.profile();
      const after = run.keep(
        await startRangeServer({ body: randomBytes(3 * MIB), fileName: 'after.bin' }),
      );
      const service = run.keep(
        await startAllDebridServer({
          accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
          hosts: { alldebrid: ['alldebrid.com'] },
          links: {
            'https://alldebrid.com/f/after': { direct: after.url, filename: 'after.bin' },
            'https://alldebrid.com/f/dead': { error: 'AUTH_BLOCKED' },
          },
        }),
      );
      const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
      const { page } = scia;
      await connect(page);
      await viewportOf(page, 1040, 720);

      await paste(page, 'https://alldebrid.com/f/after');
      await rowOf(page, 'after.bin').getByRole('button', { name: 'Show in folder' }).waitFor();
      await paste(page, 'https://alldebrid.com/f/dead');
      await rowOf(page, 'dead').getByText('is blocking the key from here').waitFor();
      await capture(scia, 'dark', 'a-failure-in-full.png');
    });
  });
});
