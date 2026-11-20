import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import { startReleasesServer } from '@scia/server/testing/yt-dlp-releases-server.ts';
import { describe, expect, it } from 'vitest';
import { YT_DLP_OF_PLATFORM, YT_DLP_VERSION } from '../src/engine/runtime-layout.ts';
import { paste, rowOf, until, useRun } from './scia.ts';

// The yt-dlp `npm start` and CI's E2E job fetch for this computer (scripts/fetch-tools.ts), and a
// release of yt-dlp as its project signed it: the sums and their signature of the release Scia
// ships, kept beside the engine's specs.
const TOOL = YT_DLP_OF_PLATFORM[process.platform];
const SHIPPED = resolve(import.meta.dirname, '..', 'tools', TOOL?.os ?? '', TOOL?.file ?? '');
const SIGNED = resolve(
  import.meta.dirname,
  '..',
  '..',
  'server',
  'src',
  'testing',
  `yt-dlp-${YT_DLP_VERSION}`,
);
// The same bytes, published again under a newer name: a second release of the same day, which
// the date of its signature allows.
const NEWER = `${YT_DLP_VERSION}.1`;

describe('the real app brings its yt-dlp up to date', () => {
  const run = useRun();

  async function releaseOf(build: Buffer) {
    if (TOOL === undefined || !existsSync(SHIPPED)) {
      throw new Error(
        `No yt-dlp at ${SHIPPED}: run node apps/desktop/scripts/fetch-tools.ts first.`,
      );
    }
    const host = run.keep(await startReleasesServer());
    host.releases.set(NEWER, {
      [TOOL.asset]: build,
      'SHA2-256SUMS': await readFile(join(SIGNED, 'SHA2-256SUMS')),
      'SHA2-256SUMS.sig': await readFile(join(SIGNED, 'SHA2-256SUMS.sig')),
    });
    host.latest = NEWER;
    return host;
  }

  it('takes a newer release signed by yt-dlp, keeps it in the profile, and reads pages with it', async () => {
    const build = await readFile(SHIPPED);
    const host = await releaseOf(build);
    const profile = await run.profile();
    const kept = join(profile.path, 'engine', 'yt-dlp', NEWER, TOOL?.file ?? '');
    const scia = await run.launch(profile, { args: [`--yt-dlp-releases=${host.address}`] });

    await until(async () => (await profile.log()).includes('yt_dlp_updated'));
    expect(Buffer.compare(await readFile(kept), build)).toBe(0);
    // The build Scia ships is never changed.
    expect(Buffer.compare(await readFile(SHIPPED), build)).toBe(0);

    // A page no reader of yt-dlp knows is still read after the update, and fetched as it stands.
    const site = run.keep(
      await startRangeServer({
        body: Buffer.from('<html>a page</html>'),
        contentType: 'text/html',
        fileName: 'page.html',
      }),
    );
    await paste(scia.page, site.url);
    await rowOf(scia.page, 'page.html')
      .getByRole('button', { name: 'Show in folder' })
      .waitFor({ timeout: 60_000 });

    await scia.quit();
    const checks = () => host.asked.filter((path) => path === '/releases/latest').length;
    const before = checks();
    await run.launch(profile, { args: [`--yt-dlp-releases=${host.address}`] });
    await until(async () => /yt_dlp_in_use[^\n]*"kept":true/.exec(await profile.log()) !== null);
    // A check at this start would have been asked as the engine began to listen, before the
    // window had its page: the last one is minutes old, the next due a day after it.
    expect(checks()).toBe(before);
  });

  it('refuses a build whose bytes are not those its signed sums give, and keeps the one it ships', async () => {
    const host = await releaseOf(Buffer.from('not the build yt-dlp signed'));
    const profile = await run.profile();
    await run.launch(profile, { args: [`--yt-dlp-releases=${host.address}`] });

    await until(async () => (await profile.log()).includes('yt_dlp_refused'));
    expect(await profile.log()).toMatch(/yt_dlp_refused[^\n]*"reason":"checksum"/);
    expect(existsSync(join(profile.path, 'engine', 'yt-dlp', NEWER))).toBe(false);
  });
});
