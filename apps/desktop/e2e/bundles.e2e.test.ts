import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REDIRECT_LINKS, startAllDebridServer } from '@scia/server/testing/alldebrid-server.ts';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import { describe, expect, it } from 'vitest';
import { allCompleted, paste, until, useRun } from './scia.ts';

const KIB = 1024;
// Made up, as every key of a spec; no host has this folder.
const KEY = 'e2e-made-up-key-0123456789';
const PREMIUM_UNTIL = 4_102_444_800;
const FOLDER = 'https://1fichier.com/dir/Holiday%20films';

describe('the real app, with a link that opens into several files (#181)', () => {
  const run = useRun();

  it('lists the files of a pasted folder, all ticked, and downloads only those left ticked into a folder named after it', async () => {
    const profile = await run.profile();
    const day1 = randomBytes(512 * KIB);
    const day2 = randomBytes(256 * KIB);
    const notes = randomBytes(3 * KIB);
    const hosts = await Promise.all(
      [day1, day2, notes].map(async (body) => run.keep(await startRangeServer({ body }))),
    );
    const links = ['day-1', 'day-2', 'notes'].map((name) => `${REDIRECT_LINKS}${name}`);
    const [one = '', two = '', three = ''] = links;
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
        hosts: { onefichier: ['1fichier.com'] },
        redirects: { [FOLDER]: links },
        links: {
          [one]: { direct: hosts[0]?.url ?? '', filename: 'Day 1.mkv', size: day1.length },
          [two]: { direct: hosts[1]?.url ?? '', filename: 'Day 2.mkv', size: day2.length },
          [three]: { direct: hosts[2]?.url ?? '', filename: 'notes.nfo', size: notes.length },
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

    await paste(page, FOLDER);

    // Its files, all ticked, and nothing asked of a host before the person chooses.
    const files = page.getByRole('group', { name: 'Files of Holiday films' });
    await files.waitFor();
    for (const name of ['Day 1.mkv', 'Day 2.mkv', 'notes.nfo']) {
      expect(await files.getByRole('checkbox', { name: new RegExp(name) }).isChecked()).toBe(true);
    }
    expect(service.requests.some((request) => request.url === '/v4/link/unlock')).toBe(false);
    await files.getByText('Day 2.mkv').click();
    await page.getByRole('button', { name: 'Download 2 files' }).click();

    await files.waitFor({ state: 'detached' });
    await until(() => allCompleted(page), 60_000);
    const root = join(profile.downloads, 'Holiday films');
    expect((await readdir(root)).sort()).toEqual(['Day 1.mkv', 'notes.nfo']);
    expect(Buffer.compare(await readFile(join(root, 'Day 1.mkv')), day1)).toBe(0);
    expect(Buffer.compare(await readFile(join(root, 'notes.nfo')), notes)).toBe(0);
    // The link went to the service, and nowhere a person reads.
    const log = await profile.log();
    expect(log).not.toContain('1fichier');
    expect(log).not.toContain(REDIRECT_LINKS);
  });
});
