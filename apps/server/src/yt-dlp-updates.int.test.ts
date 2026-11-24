import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  open as openFile,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from './logger.ts';
import { signingKeyOf } from './openpgp.ts';
import { testKey } from './testing/openpgp-signer.ts';
import { scratchFolder, until } from './testing/scratch.ts';
import {
  type ReleasesServer,
  signedRelease,
  startReleasesServer,
} from './testing/yt-dlp-releases-server.ts';
import { YtDlpReleases } from './yt-dlp-releases.ts';
import {
  type Activity,
  openYtDlpUpdates,
  YtDlpUpdates,
  type YtDlpUpdatesOptions,
} from './yt-dlp-updates.ts';

const SHIPPED = '2026.10.26';
const NEWER = '2026.11.18';
const DAY_MS = 400;
const RETRY_MS = 100;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// The person's downloads, as the updater hears of them.
class Downloads implements Activity {
  busy = false;
  readonly #listeners = new Set<(busy: boolean) => void>();

  isBusy(): boolean {
    return this.busy;
  }

  onBusyChange(listener: (busy: boolean) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(busy: boolean): void {
    this.busy = busy;
    for (const listener of this.#listeners) listener(busy);
  }
}

describe('YtDlpUpdates against a host that publishes releases as yt-dlp does', () => {
  const key = testKey();
  const newBuild = Buffer.from('the build of 2026.11.18, as yt-dlp released it');
  let host: ReleasesServer;
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let shipped: string;
  let downloads: Downloads;
  let logged: { event: string; details: Record<string, unknown> }[];
  let opened: YtDlpUpdates[];
  // The wait before each check, as the updater chose it.
  let delays: number[];

  const logger: Logger = {
    info: (event, details = {}) =>
      logged.push({ event, details: details as Record<string, unknown> }),
    warn: (event, details = {}) =>
      logged.push({ event, details: details as Record<string, unknown> }),
    error: (event, details = {}) =>
      logged.push({ event, details: details as Record<string, unknown> }),
  };
  const events = () => logged.map(({ event }) => event);
  const updatesFolder = () => join(folder.path, 'engine', 'yt-dlp');
  const keptPath = (version: string) => join(updatesFolder(), version, 'yt-dlp.exe');
  // A build's first bytes are written and the rest are held by the host: the fetch is under way.
  const midway = async () =>
    ((await stat(`${keptPath(NEWER)}.part`).catch(() => undefined))?.size ?? 0) > 0;
  // The requests for a build, not the redirects they were answered with.
  const builds = () =>
    host.asked.filter(
      (path) => path.startsWith('/releases/download/') && path.endsWith('/yt-dlp.exe'),
    );

  beforeEach(async () => {
    host = await startReleasesServer();
    folder = await scratchFolder();
    shipped = join(folder.path, 'resources', 'tools', 'yt-dlp.exe');
    await mkdir(join(folder.path, 'resources', 'tools'), { recursive: true });
    await writeFile(shipped, 'the build Scia shipped');
    downloads = new Downloads();
    logged = [];
    opened = [];
    delays = [];
    host.latest = SHIPPED;
  });
  afterEach(async () => {
    await Promise.all(opened.map((updates) => updates.close()));
    await host.close();
    await folder.remove();
  });

  async function open(options: Partial<YtDlpUpdatesOptions> = {}): Promise<YtDlpUpdates> {
    const updates = await YtDlpUpdates.open({
      shipped: { path: shipped, version: SHIPPED },
      asset: 'yt-dlp.exe',
      folder: updatesFolder(),
      releases: new YtDlpReleases({
        address: host.address,
        userAgent: 'Scia/test',
        silenceMs: 2_000,
      }),
      signingKey: signingKeyOf(key.armored),
      logger,
      dayMs: DAY_MS,
      retryMs: RETRY_MS,
      schedule: (run, ms) => {
        delays.push(ms);
        const timer = setTimeout(run, ms);
        return () => {
          clearTimeout(timer);
        };
      },
      ...options,
    });
    opened.push(updates);
    return updates;
  }

  const publish = (tag: string, options: Parameters<typeof signedRelease>[2] = {}) => {
    host.releases.set(
      tag,
      signedRelease({ 'yt-dlp.exe': newBuild }, key.privateKey, {
        createdAt: new Date(`${tag.slice(0, 10).replaceAll('.', '-')}T09:00:00Z`),
        ...options,
      }),
    );
    host.latest = tag;
  };

  it('uses the build it shipped with while no newer release is out, and asks again a day later', async () => {
    const updates = await open();
    expect(updates.command()).toBe(shipped);
    updates.start(downloads);
    await until(() => host.asked.length === 1);
    expect(host.asked).toEqual(['/releases/latest']);
    await until(() => delays.length === 3, 5_000);
    expect(host.asked).toHaveLength(2);
    expect(delays).toEqual([0, DAY_MS, DAY_MS]);
    expect(updates.command()).toBe(shipped);
  });

  it('takes a newer release whose build matches its signed sums, for the reads after', async () => {
    publish(NEWER);
    const updates = await open();
    updates.start(downloads);
    await until(() => updates.version() === NEWER);

    expect(updates.command()).toBe(keptPath(NEWER));
    expect(await readFile(keptPath(NEWER))).toEqual(newBuild);
    expect(await readFile(shipped, 'utf8')).toBe('the build Scia shipped');
    expect(logged).toContainEqual({
      event: 'yt_dlp_updated',
      details: { from: SHIPPED, to: NEWER },
    });
    expect(await readdir(join(updatesFolder(), NEWER))).toEqual(['yt-dlp.exe']);
    // A program, where the system asks a file to say so.
    if (process.platform !== 'win32') {
      expect((await stat(keptPath(NEWER))).mode & 0o111).not.toBe(0);
    }
  });

  it('does not hold a check back for a last check the clock puts in the future', async () => {
    const first = await open({ now: () => Date.now() + 10 * DAY_MS });
    first.start(downloads);
    await until(() => events().includes('yt_dlp_checked'));
    await first.close();

    const second = await open();
    delays = [];
    second.start(downloads);
    expect(delays).toEqual([0]);
  });

  it('starts again with the build it took, without asking, and asks a day after the last check', async () => {
    // The time of the checks is the spec's: read from the machine's clock, the wait it held to more
    // than half a day was less on a loaded run, which took that long between the two starts (#165).
    let now = Date.parse('2026-11-23T12:00:00.000Z');
    publish(NEWER);
    const first = await open({ now: () => now });
    first.start(downloads);
    await until(() => first.version() === NEWER);
    await first.close();
    const asked = host.asked.length;

    now += DAY_MS / 4;
    const second = await open({ now: () => now });
    expect(second.command()).toBe(keptPath(NEWER));
    delays = [];
    second.start(downloads);
    // Not at once: the last check was a quarter of a day ago.
    expect(delays).toEqual([DAY_MS - DAY_MS / 4]);
    await until(() => host.asked.length > asked, 5_000);
  });

  it('asks at once at a start a day or more after the last check', async () => {
    const first = await open({ now: () => Date.now() - 2 * DAY_MS });
    first.start(downloads);
    await until(() => host.asked.length === 1);
    await until(() => logged.some(({ event }) => event === 'yt_dlp_checked'));
    await first.close();

    const second = await open();
    delays = [];
    second.start(downloads);
    expect(delays).toEqual([0]);
    await until(() => host.asked.length === 2);
  });

  // Windows refuses a rename onto a file another process has open; Linux allows it.
  it.runIf(process.platform === 'win32')(
    'keeps the time of a check while another program holds its file for a moment, as an antivirus does on Windows (#307)',
    async () => {
      // The spec's clock: the second check is due because a day went by since the first.
      const firstAt = Date.parse('2026-11-24T12:00:00.000Z');
      const secondAt = firstAt + 2 * DAY_MS;
      const first = await open({ now: () => firstAt });
      first.start(downloads);
      await until(() => events().includes('yt_dlp_checked'));
      await first.close();
      const state = join(updatesFolder(), 'state.json');
      const held = await openFile(state, 'r');
      logged = [];

      const second = await open({ now: () => secondAt });
      const startedAt = performance.now();
      second.start(downloads);
      setTimeout(() => void held.close(), 300);
      await until(() => events().some((event) => event.startsWith('yt_dlp_check')));
      const tookMs = performance.now() - startedAt;

      expect(events()).not.toContain('yt_dlp_check_failed');
      expect(JSON.parse(await readFile(state, 'utf8'))).toMatchObject({
        checkedAt: new Date(secondAt).toISOString(),
      });
      // The premise: the state's write waited for the file. One that landed at once would hold
      // nothing of the retry.
      expect(tookMs, `the check ended in ${String(Math.round(tookMs))} ms`).toBeGreaterThanOrEqual(
        250,
      );
    },
  );

  it('goes back to the build it shipped with when the one it took has changed on the disk', async () => {
    publish(NEWER);
    const first = await open();
    first.start(downloads);
    await until(() => first.version() === NEWER);
    await first.close();
    await writeFile(keptPath(NEWER), 'something else');

    const second = await open();
    expect(second.command()).toBe(shipped);
    expect(existsSync(join(updatesFolder(), NEWER))).toBe(false);
    expect(events()).toContain('yt_dlp_kept_build_changed');

    // Forgotten, not found changed again at every start.
    await second.close();
    await open();
    expect(events().filter((event) => event === 'yt_dlp_kept_build_changed')).toHaveLength(1);
  });

  it('drops the build it took once Scia ships one as new or newer', async () => {
    publish(NEWER);
    const first = await open();
    first.start(downloads);
    await until(() => first.version() === NEWER);
    await first.close();

    const second = await open({ shipped: { path: shipped, version: NEWER } });
    expect(second.command()).toBe(shipped);
    expect(second.version()).toBe(NEWER);
    expect(existsSync(join(updatesFolder(), NEWER))).toBe(false);
  });

  it('starts when a build it no longer uses cannot be removed, and removes it at a later start', async () => {
    const left = join(updatesFolder(), '2026.11.01');
    await mkdir(left, { recursive: true });
    // Held as Windows holds a program that runs; elsewhere, by a folder that refuses removals.
    let release: () => Promise<void>;
    if (process.platform === 'win32') {
      const program = join(left, 'yt-dlp.exe');
      await copyFile(process.execPath, program);
      const running = spawn(program, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
      await until(() => running.pid !== undefined);
      release = async () => {
        running.kill();
        await new Promise((done) => running.once('exit', done));
      };
    } else {
      await writeFile(join(left, 'yt-dlp'), 'old');
      await chmod(left, 0o500);
      release = () => chmod(left, 0o700);
    }

    const updates = await open();
    expect(updates.command()).toBe(shipped);
    expect(events()).toContain('yt_dlp_not_removed');
    await release();

    await open();
    expect(existsSync(left)).toBe(false);
  });

  it('leaves the shipped build reading pages when it cannot be opened at all', async () => {
    await mkdir(join(folder.path, 'engine'), { recursive: true });
    // Its folder is a file: nothing can be kept there.
    await writeFile(updatesFolder(), 'not a folder');
    const updates = await openYtDlpUpdates({
      shipped: { path: shipped, version: SHIPPED },
      asset: 'yt-dlp.exe',
      folder: updatesFolder(),
      releases: new YtDlpReleases({ address: host.address, userAgent: 'Scia/test' }),
      signingKey: signingKeyOf(key.armored),
      logger,
    });
    expect(updates).toBeUndefined();
    expect(events()).toContain('yt_dlp_updates_off');
  });

  it('never takes a release older than the build in use, however well it is signed', async () => {
    publish('2026.10.21');
    const updates = await open();
    updates.start(downloads);
    await until(() => events().includes('yt_dlp_checked'));
    expect(updates.command()).toBe(shipped);
    expect(builds()).toEqual([]);
    expect(host.asked).toEqual(['/releases/latest']);
  });

  it('ends at once when it is closed just before it would wait for the downloads', async () => {
    publish(NEWER);
    let closed = false;
    // The stop arrives as the updater looks at the downloads, before it starts listening to them.
    const stopping: Activity = {
      isBusy: () => {
        void updates.close().then(() => {
          closed = true;
        });
        return true;
      },
      onBusyChange: () => () => undefined,
    };
    const updates = await open();
    updates.start(stopping);
    await until(() => closed, 5_000);
    expect(builds()).toEqual([]);
  });

  it('gives a build up for a download that started between its wait and its listening', async () => {
    publish(NEWER);
    let looks = 0;
    // Idle when it waits; busy the moment after, before any change could be heard.
    const between: Activity = {
      isBusy: () => {
        looks += 1;
        return looks === 2;
      },
      onBusyChange: () => () => undefined,
    };
    const updates = await open();
    updates.start(between);
    await until(() => updates.version() === NEWER);
    expect(events()).toContain('yt_dlp_fetch_yielded');
  });

  it('removes at its start whatever is left of builds it no longer uses', async () => {
    await mkdir(join(updatesFolder(), '2026.11.01'), { recursive: true });
    await writeFile(join(updatesFolder(), '2026.11.01', 'yt-dlp.exe'), 'old');
    await mkdir(join(updatesFolder(), NEWER), { recursive: true });
    await writeFile(join(updatesFolder(), NEWER, 'yt-dlp.exe.part'), 'half');

    await open();
    expect(await readdir(updatesFolder())).toEqual([]);
  });

  describe('refuses a build, keeps the one in use, and asks again a day later, not sooner', () => {
    async function refused(reason: string): Promise<void> {
      const updates = await open();
      updates.start(downloads);
      await until(() => events().includes('yt_dlp_refused'));
      expect(logged).toContainEqual({
        event: 'yt_dlp_refused',
        details: { version: NEWER, reason },
      });
      expect(updates.command()).toBe(shipped);
      expect(existsSync(join(updatesFolder(), NEWER))).toBe(false);
      await until(() => delays.length === 2);
      expect(delays).toEqual([0, DAY_MS]);
    }

    it('whose bytes are not those its sums give', async () => {
      publish(NEWER, { sums: `${sha256(Buffer.from('another build'))}  yt-dlp.exe\n` });
      await refused('checksum');
      expect(builds()).toHaveLength(1);
    });

    it('whose sums are signed with another key than yt-dlp’s', async () => {
      host.releases.set(NEWER, signedRelease({ 'yt-dlp.exe': newBuild }, testKey().privateKey));
      host.latest = NEWER;
      await refused('signature');
      expect(builds()).toEqual([]);
    });

    it('whose sums are another release’s, signed before its day', async () => {
      publish(NEWER, { createdAt: new Date('2026-10-26T09:00:00Z') });
      await refused('signed_before_release');
      expect(builds()).toEqual([]);
    });

    it('which its sums do not list', async () => {
      publish(NEWER, { sums: `${sha256(newBuild)}  yt-dlp_linux\n` });
      await refused('not_listed');
      expect(builds()).toEqual([]);
    });
  });

  it('keeps the build in use when the releases cannot be read, and asks again an hour later', async () => {
    host.misbehave = 'busy';
    const updates = await open();
    updates.start(downloads);
    await until(() => events().includes('yt_dlp_check_failed'));
    expect(updates.command()).toBe(shipped);
    await until(() => delays.length === 2);
    expect(delays).toEqual([0, RETRY_MS]);
    host.misbehave = undefined;
    publish(NEWER);
    await until(() => updates.version() === NEWER);
  });

  it('keeps the build in use when a release has no signature to read', async () => {
    publish(NEWER);
    const files = host.releases.get(NEWER) ?? {};
    delete files['SHA2-256SUMS.sig'];
    const updates = await open();
    updates.start(downloads);
    await until(() => events().includes('yt_dlp_check_failed'));
    expect(updates.command()).toBe(shipped);
    expect(builds()).toEqual([]);
    await until(() => delays.length === 2);
    expect(delays).toEqual([0, RETRY_MS]);
  });

  it('fetches a build only while no download runs or waits', async () => {
    publish(NEWER);
    downloads.set(true);
    const updates = await open();
    updates.start(downloads);
    await until(() => events().includes('yt_dlp_waiting_for_downloads'));
    expect(builds()).toEqual([]);

    downloads.set(false);
    await until(() => updates.version() === NEWER);
    expect(builds()).toHaveLength(1);
  });

  it('gives a build up when a download starts, and fetches it whole when none runs again', async () => {
    host.releases.set(
      NEWER,
      signedRelease({ 'yt-dlp.exe': Buffer.alloc(2 * 1024 * 1024, 3) }, key.privateKey, {
        createdAt: new Date('2026-11-18T09:00:00Z'),
      }),
    );
    host.latest = NEWER;
    const letGo = host.holdBuilds();
    const updates = await open();
    updates.start(downloads);
    await until(midway);
    downloads.set(true);
    await until(() => events().includes('yt_dlp_fetch_yielded'));
    expect(existsSync(`${keptPath(NEWER)}.part`)).toBe(false);
    expect(updates.command()).toBe(shipped);

    letGo();
    downloads.set(false);
    await until(() => updates.version() === NEWER);
    expect(builds()).toHaveLength(2);
    expect(sha256(await readFile(keptPath(NEWER)))).toBe(sha256(Buffer.alloc(2 * 1024 * 1024, 3)));
  });

  it('stops a fetch under way when it is closed, and leaves no part of it', async () => {
    host.releases.set(
      NEWER,
      signedRelease({ 'yt-dlp.exe': Buffer.alloc(2 * 1024 * 1024, 3) }, key.privateKey, {
        createdAt: new Date('2026-11-18T09:00:00Z'),
      }),
    );
    host.latest = NEWER;
    const letGo = host.holdBuilds();
    const updates = await open();
    updates.start(downloads);
    await until(midway);
    await updates.close();
    letGo();
    expect(existsSync(`${keptPath(NEWER)}.part`)).toBe(false);
    expect(updates.command()).toBe(shipped);
    // A stop is not a failure: nothing is said of it, and nothing is tried again.
    expect(events()).not.toContain('yt_dlp_check_failed');
    expect(delays).toEqual([0]);
  });
});
