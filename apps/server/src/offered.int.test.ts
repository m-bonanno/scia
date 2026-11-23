import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IntegrationId } from '@scia/contracts';
import { DownloadStatus, ServiceFailure, UnlockFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllDebrid } from './alldebrid.ts';
import { DownloadManager, type ManagerDeps } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { Integrations } from './integrations.ts';
import { MemoryVault } from './key-vault.ts';
import type { LinkResolver } from './link-resolver.ts';
import { ServiceError } from './service-error.ts';
import { JsonStateStore } from './state-store.ts';
import { startAllDebridServer } from './testing/alldebrid-server.ts';
import { type RangeServer, startRangeServer } from './testing/range-server.ts';
import { scratchFolder, silentLogger, until } from './testing/scratch.ts';

const body = randomBytes(256 * 1024 + 3);
const VIDEO_PAGE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// A service that takes hoster.example's links, says another file host needs one, and cannot say
// anything of a third: what `Integrations` answers, without a service.
const resolver: LinkResolver = {
  serviceFor: (url) => {
    const host = new URL(url).hostname;
    if (host === 'hoster.example') return Promise.resolve(IntegrationId.AllDebrid);
    if (host === 'needs.example') {
      return Promise.reject(
        new ServiceError(IntegrationId.AllDebrid, UnlockFailure.NeedsService, 'Needs one.'),
      );
    }
    if (host === 'unknown.example') {
      return Promise.reject(
        new ServiceError(IntegrationId.AllDebrid, ServiceFailure.Unavailable, 'Cannot say.'),
      );
    }
    return Promise.resolve(undefined);
  },
  unlock: () => Promise.reject(new Error('Nothing is unlocked by an offer.')),
  hasService: () => true,
  open: () => Promise.reject(new Error('Nothing is opened by an offer.')),
};

describe('links offered from the clipboard', () => {
  const source = new HttpSource('scia-test');
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let server: RangeServer;
  let manager: DownloadManager | undefined;

  beforeEach(async () => {
    folder = await scratchFolder();
    server = await startRangeServer({ body });
  });
  afterEach(async () => {
    await manager?.close();
    manager = undefined;
    await server.close();
    await folder.remove();
  });

  // The host answers any path: a link to it may end with any name.
  const at = (name: string) => server.url.replace('sample.bin', name);
  const statePath = () => join(folder.path, 'data', 'state.json');

  // A resolver of its own unless told none: `null`.
  async function open(
    overrides: Partial<ManagerDeps> = {},
    withResolver: LinkResolver | null = resolver,
  ): Promise<DownloadManager> {
    manager = await DownloadManager.open({
      source,
      store: new JsonStateStore(statePath()),
      defaultDirectory: join(folder.path, 'downloads'),
      logger: silentLogger,
      retryDelayMs: () => 1,
      ...(withResolver === null ? {} : { resolver: withResolver }),
      ...overrides,
    });
    return manager;
  }

  it('adds the files and the videos it knows, ready, in the order copied, and starts none of them', async () => {
    const downloads = await open();

    const added = await downloads.offer([
      at('photo.jpg'),
      at('archive.zip'),
      'https://example.com/blog/post',
      VIDEO_PAGE,
      at('page.html'),
    ]);

    expect(added.map((download) => download.url)).toEqual([at('archive.zip'), VIDEO_PAGE]);
    expect(added.every((download) => download.status === DownloadStatus.Ready)).toBe(true);
    expect(downloads.snapshot().downloads.map((download) => download.status)).toEqual([
      DownloadStatus.Ready,
      DownloadStatus.Ready,
    ]);
    // Nothing was asked of the host, and nothing is on the disk.
    expect(server.ranges).toEqual([]);
    expect(existsSync(join(folder.path, 'downloads'))).toBe(false);
  });

  it("takes a file host's link as the service says, and none it cannot say anything of", async () => {
    const downloads = await open();

    const added = await downloads.offer([
      'https://hoster.example/f/1',
      'https://needs.example/f/2',
      'https://unknown.example/f/3',
      'https://elsewhere.example/f/4',
    ]);

    expect(added.map((download) => download.url)).toEqual([
      'https://hoster.example/f/1',
      'https://needs.example/f/2',
    ]);
  });

  it("takes a file host's link with no service connected, by AllDebrid's public list, and tells it nothing of the links", async () => {
    const alldebrid = await startAllDebridServer({
      accounts: {},
      hosts: { hoster: ['hoster.example'] },
    });
    try {
      const integrations = await Integrations.open({
        vault: new MemoryVault(),
        alldebrid: new AllDebrid({ api: alldebrid.api, userAgent: 'Scia/spec' }),
        logger: silentLogger,
      });
      const downloads = await open({ resolver: integrations });

      const added = await downloads.offer([
        'https://www.hoster.example/f/abc123',
        'https://elsewhere.example/f/def456',
      ]);

      expect(added.map((download) => download.url)).toEqual([
        'https://www.hoster.example/f/abc123',
      ]);
      expect(added[0]?.status).toBe(DownloadStatus.Ready);
      expect(alldebrid.requests.map((request) => request.url)).toEqual(['/v4/hosts/domains']);
      expect(JSON.stringify(alldebrid.requests)).not.toMatch(/abc123|def456/);
    } finally {
      await alldebrid.close();
    }
  });

  it('takes no file host without a resolver, and the files all the same', async () => {
    const downloads = await open({}, null);

    const added = await downloads.offer(['https://hoster.example/f/1', at('setup.exe')]);

    expect(added.map((download) => download.url)).toEqual([at('setup.exe')]);
  });

  it('does not add a link already in the list, whatever its state, nor one copied twice', async () => {
    const downloads = await open();
    const [done] = downloads.add({ urls: [at('done.zip')] });
    await until(() => downloads.find(done!.id).status === DownloadStatus.Completed);
    await downloads.offer([at('ready.zip')]);

    const added = await downloads.offer([
      at('done.zip'),
      at('ready.zip'),
      at('new.zip'),
      at('new.zip'),
      // The same address, as the browser writes it.
      at('done.zip').replace('http:', 'HTTP:'),
    ]);

    expect(added.map((download) => download.url)).toEqual([at('new.zip')]);
    expect(downloads.snapshot().downloads).toHaveLength(3);
  });

  it('adds each link once when two offers of it arrive together', async () => {
    const downloads = await open();

    const [first, second] = await Promise.all([
      downloads.offer(['https://hoster.example/f/1', at('a.zip')]),
      downloads.offer([at('a.zip'), 'https://hoster.example/f/1']),
    ]);

    expect([...first, ...second].map((download) => download.url).sort()).toEqual(
      [at('a.zip'), 'https://hoster.example/f/1'].sort(),
    );
    expect(downloads.snapshot().downloads).toHaveLength(2);
  });

  it('downloads a ready link at its Start, byte for byte', async () => {
    const downloads = await open();
    const [ready] = await downloads.offer([at('archive.zip')]);

    const started = downloads.start(ready!.id);

    expect(started.status).not.toBe(DownloadStatus.Ready);
    await until(() => downloads.find(ready!.id).status === DownloadStatus.Completed);
    expect(
      Buffer.compare(await readFile(join(folder.path, 'downloads', 'archive.zip')), body),
    ).toBe(0);
  });

  it('starts every ready link at once when asked, within the queue’s limit, and nothing else', async () => {
    const downloads = await open();
    downloads.updateSettings({ maxConcurrentDownloads: 1 });
    const [paused] = downloads.add({ urls: [at('paused.zip')] });
    await downloads.pause(paused!.id);
    await downloads.offer([at('a.zip'), at('b.zip'), at('c.zip')]);

    const started = downloads.startReady();

    expect(started.map((download) => download.url)).toEqual([
      at('a.zip'),
      at('b.zip'),
      at('c.zip'),
    ]);
    await until(() =>
      started.every((download) => downloads.find(download.id).status === DownloadStatus.Completed),
    );
    expect(downloads.find(paused!.id).status).toBe(DownloadStatus.Paused);
    expect((await readdir(join(folder.path, 'downloads'))).sort()).toEqual([
      'a.zip',
      'b.zip',
      'c.zip',
    ]);
  });

  it('is not busy with ready links: they wait for the person, not for the engine', async () => {
    const downloads = await open();

    await downloads.offer([at('a.zip')]);

    expect(downloads.isBusy()).toBe(false);
  });

  it('refuses to start what is not ready', async () => {
    const downloads = await open();
    const [queued] = downloads.add({ urls: [at('a.zip')] });

    expect(() => downloads.start(queued!.id)).toThrow(/ready/i);
  });

  it('removes a ready link with nothing to delete', async () => {
    const downloads = await open();
    const [ready] = await downloads.offer([at('a.zip')]);

    await downloads.remove(ready!.id, false);

    expect(downloads.snapshot().downloads).toEqual([]);
  });

  it('keeps ready links ready after the engine stops and starts again', async () => {
    const first = await open();
    const [ready] = await first.offer([at('a.zip')]);
    await first.close();

    const second = await open();

    expect(second.find(ready!.id).status).toBe(DownloadStatus.Ready);
    expect(server.ranges).toEqual([]);
  });

  it('says whether the clipboard is watched with every list, keeps the switch, and loads a state without it with it off', async () => {
    const first = await open();
    expect(first.settings().watchClipboard).toBe(false);
    expect(first.snapshot().watchClipboard).toBe(false);
    first.updateSettings({ watchClipboard: true });
    expect(first.snapshot().watchClipboard).toBe(true);
    await first.close();

    const second = await open();
    expect(second.settings().watchClipboard).toBe(true);
    await second.close();
    const state = JSON.parse(await readFile(statePath(), 'utf8')) as {
      settings: Record<string, unknown>;
    };
    delete state.settings.watchClipboard;
    await writeFile(statePath(), JSON.stringify(state));

    expect((await open()).settings().watchClipboard).toBe(false);
    expect(existsSync(`${statePath()}.unreadable`)).toBe(false);
  });
});
