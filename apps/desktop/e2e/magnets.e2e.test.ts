import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startAllDebridServer } from '@scia/server/testing/alldebrid-server.ts';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import { describe, expect, it } from 'vitest';
import { allCompleted, paste, until, useRun } from './scia.ts';

const KIB = 1024;
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
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Use an API key' }).click();
    await page.getByLabel('AllDebrid API key').fill(KEY);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();

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
    expect(
      Buffer.compare(await readFile(join(profile.downloads, 'Concert', 'film.mkv')), film),
    ).toBe(0);
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
});
