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
});
