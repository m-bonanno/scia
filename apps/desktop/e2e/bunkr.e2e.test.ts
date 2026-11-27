import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSigned, startBunkrServer } from '@scia/server/testing/bunkr-server.ts';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import { describe, expect, it } from 'vitest';
import { allCompleted, downloadsOf, paste, until, useRun } from './scia.ts';

const KIB = 1024;

// The built app pointed at a local host that answers as Bunkr does (`--bunkr=`, docs/adr/0024):
// never Bunkr itself.
describe('the real app, with a Bunkr album', () => {
  const run = useRun();

  it('downloads every file of a pasted album into a folder named after it, byte for byte', async () => {
    const profile = await run.profile();
    const film = randomBytes(512 * KIB);
    const notes = randomBytes(3 * KIB);
    // Bunkr's file servers: a link their signing service did not sign is refused (#398).
    const filmHost = run.keep(await startRangeServer({ body: film, accepts: isSigned }));
    const notesHost = run.keep(await startRangeServer({ body: notes, accepts: isSigned }));
    const site = run.keep(
      await startBunkrServer({
        albums: {
          AbCd12: {
            title: 'Holiday 2026',
            files: [
              { id: '101', slug: 'Day-1-AbCd', original: 'Day 1.mp4', link: filmHost.url },
              { id: '102', slug: 'notes-EfGh', original: 'notes.txt', link: notesHost.url },
            ],
          },
        },
      }),
    );
    const scia = await run.launch(profile, { args: [`--bunkr=${site.url}`] });

    await paste(scia.page, `${site.url}/a/AbCd12`);

    await until(
      async () => (await downloadsOf(scia.page)).length === 2 && allCompleted(scia.page),
      60_000,
    );
    const folder = join(profile.downloads, 'Holiday 2026');
    expect((await readdir(folder)).sort()).toEqual(['Day 1.mp4', 'notes.txt']);
    expect(Buffer.compare(await readFile(join(folder, 'Day 1.mp4')), film)).toBe(0);
    expect(Buffer.compare(await readFile(join(folder, 'notes.txt')), notes)).toBe(0);
    // Read as Bunkr's own pages ask, with Scia's own user agent; the album is in no line of the log.
    expect(site.asked.some(({ path }) => path === '/api/_001_v2')).toBe(true);
    expect(site.asked.filter(({ path }) => path === '/sign')).toHaveLength(2);
    for (const { userAgent } of site.asked) expect(userAgent).toMatch(/Scia\//);
    expect(await profile.log()).not.toContain('AbCd12');
  });
});
