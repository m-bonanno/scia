import { randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IntegrationId } from '@scia/contracts';
import { DownloadFailure, DownloadStatus } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllDebrid } from './alldebrid.ts';
import { DownloadManager } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { Integrations } from './integrations.ts';
import { MemoryVault } from './key-vault.ts';
import type { Logger } from './logger.ts';
import { JsonStateStore } from './state-store.ts';
import {
  type AllDebridServer,
  type AllDebridServerOptions,
  startAllDebridServer,
} from './testing/alldebrid-server.ts';
import {
  type RangeServer,
  type RangeServerOptions,
  startRangeServer,
} from './testing/range-server.ts';
import { scratchFolder, until } from './testing/scratch.ts';

const MIB = 1024 * 1024;
const body = randomBytes(4 * MIB + 7);
// Made up: no account anywhere has this key, and no hoster has this address.
const KEY = 'spec-key-0000000000000000';
const LINK = 'https://hoster.example/f/abc123';
const PREMIUM_UNTIL = Date.UTC(2027, 5, 30, 12) / 1000;

// A pasted hoster link, from the paste to the file: the manager, the services, AllDebrid's
// client and the downloader, against the simulated service and a real local host.
describe('a link that goes through a service', () => {
  const source = new HttpSource('scia-test');
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let files: RangeServer[];
  let service: AllDebridServer | undefined;
  let manager: DownloadManager | undefined;
  let logged: string[];
  let logger: Logger;

  beforeEach(async () => {
    folder = await scratchFolder();
    files = [];
    logged = [];
    const log = (event: string, details?: object) => {
      logged.push(JSON.stringify({ event, ...details }));
    };
    logger = { info: log, warn: log, error: log };
  });
  afterEach(async () => {
    await manager?.close();
    manager = undefined;
    await service?.close();
    service = undefined;
    await Promise.all(files.map((host) => host.close()));
    await folder.remove();
  });

  async function fileHost(options: Partial<RangeServerOptions> = {}): Promise<RangeServer> {
    const host = await startRangeServer({ body, ...options });
    files.push(host);
    return host;
  }

  async function serviceWith(options: Partial<AllDebridServerOptions>): Promise<AllDebridServer> {
    service = await startAllDebridServer({
      accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
      hosts: { hoster: ['hoster.example'] },
      ...options,
    });
    return service;
  }

  async function connected(to: AllDebridServer, vault = new MemoryVault()): Promise<Integrations> {
    await vault.write(IntegrationId.AllDebrid, KEY);
    return Integrations.open({
      vault,
      alldebrid: new AllDebrid({
        api: to.api,
        userAgent: 'Scia/spec',
        delayedPollMs: 1,
        retryDelayMs: () => 1,
      }),
      logger,
    });
  }

  const statePath = () => join(folder.path, 'data', 'state.json');
  async function open(resolver: Integrations | undefined): Promise<DownloadManager> {
    manager = await DownloadManager.open({
      source,
      store: new JsonStateStore(statePath()),
      defaultDirectory: join(folder.path, 'downloads'),
      logger,
      retryDelayMs: () => 1,
      ...(resolver === undefined ? {} : { resolver }),
    });
    return manager;
  }

  const inDownloads = (name: string) => join(folder.path, 'downloads', name);
  const unlocks = (of: AllDebridServer) =>
    of.requests.filter((request) => request.url === '/v4/link/unlock');
  async function finished(downloads: DownloadManager, id: string, status: DownloadStatus) {
    await until(() => downloads.find(id).status === status);
    return downloads.find(id);
  }

  it('is unlocked and downloaded as a direct link would be, and says which service it went through', async () => {
    const host = await fileHost({ fileName: 'Film.mkv' });
    const alldebrid = await serviceWith({ links: { [LINK]: { direct: host.url } } });
    const downloads = await open(await connected(alldebrid));

    const [added] = downloads.add({ urls: [LINK] });
    const done = await finished(downloads, added!.id, DownloadStatus.Completed);

    expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), body)).toBe(0);
    expect(done.via).toBe('alldebrid');
    // What it is known by is the link that was pasted: the one the service gave is not shown.
    expect(done.url).toBe(LINK);
    expect(JSON.stringify(done)).not.toContain(host.url);
    expect(unlocks(alldebrid).map((request) => request.form)).toEqual([{ link: LINK }]);
    // Over several connections, like any file whose host serves ranges.
    expect(new Set(host.ranges).size).toBeGreaterThan(2);
  });

  it('fetches a link that is no hoster’s as it stands, and tells the service nothing of it', async () => {
    const host = await fileHost({ fileName: 'direct.bin' });
    const alldebrid = await serviceWith({ links: {} });
    const downloads = await open(await connected(alldebrid));

    const [added] = downloads.add({ urls: [host.url] });
    const done = await finished(downloads, added!.id, DownloadStatus.Completed);

    expect(done.via).toBeNull();
    expect(Buffer.compare(await readFile(inDownloads('direct.bin')), body)).toBe(0);
    expect(alldebrid.requests.map((request) => request.url)).toEqual(['/v4.1/user/hosts']);
    expect(JSON.stringify(alldebrid.requests)).not.toContain(host.url);
  });

  it('asks no service anything while none is connected', async () => {
    const host = await fileHost({ fileName: 'direct.bin' });
    const alldebrid = await serviceWith({ links: {} });
    const none = await Integrations.open({
      vault: new MemoryVault(),
      alldebrid: new AllDebrid({ api: alldebrid.api, userAgent: 'Scia/spec' }),
      logger,
    });
    const downloads = await open(none);

    const [added] = downloads.add({ urls: [host.url] });
    await finished(downloads, added!.id, DownloadStatus.Completed);

    expect(alldebrid.requests).toEqual([]);
  });

  it('takes the links of a host’s subdomains, and not of a domain that only looks like it', async () => {
    const host = await fileHost();
    const alldebrid = await serviceWith({
      links: { 'https://www.hoster.example/f/1': { direct: host.url } },
    });
    const integrations = await connected(alldebrid);
    const never = new AbortController().signal;

    expect(await integrations.serviceFor('https://www.hoster.example/f/1', never)).toBe(
      'alldebrid',
    );
    expect(await integrations.serviceFor('https://HOSTER.example/f/1', never)).toBe('alldebrid');
    for (const other of [
      'https://nothoster.example/f/1',
      'https://hoster.example.evil.test/f/1',
      'https://evil.test/hoster.example/f/1',
      'https://evil.test/?u=hoster.example',
      'not an address',
    ]) {
      expect(await integrations.serviceFor(other, never), other).toBeUndefined();
    }
  });

  it('reads the hosts of the service once for all the links that wait, and again after six hours', async () => {
    const alldebrid = await serviceWith({ links: {} });
    let clock = 0;
    const integrations = await Integrations.open({
      vault: await (async () => {
        const vault = new MemoryVault();
        await vault.write(IntegrationId.AllDebrid, KEY);
        return vault;
      })(),
      alldebrid: new AllDebrid({
        api: alldebrid.api,
        userAgent: 'Scia/spec',
        retryDelayMs: () => 1,
      }),
      logger,
      now: () => clock,
    });
    const never = new AbortController().signal;
    const ask = () => integrations.serviceFor(LINK, never);

    await Promise.all([ask(), ask(), ask()]);
    clock += 6 * 60 * 60_000 - 1;
    await ask();
    expect(alldebrid.requests).toHaveLength(1);

    clock += 1;
    await ask();
    expect(alldebrid.requests).toHaveLength(2);

    // A list that cannot be read again is still the list.
    alldebrid.misbehave({ status: 503 });
    clock += 6 * 60 * 60_000;
    expect(await ask()).toBe('alldebrid');
  });

  it('does not start a link on a guess: while the service cannot say which links are its own, it fails and says so', async () => {
    const host = await fileHost();
    const alldebrid = await serviceWith({ links: {} });
    alldebrid.misbehave({ status: 503 });
    const downloads = await open(await connected(alldebrid));

    const [added] = downloads.add({ urls: [host.url] });
    const failed = await finished(downloads, added!.id, DownloadStatus.Failed);

    expect(failed.failure).toBe(DownloadFailure.Unavailable);
    // The link was never known to be the service's.
    expect(failed.via).toBeNull();
    expect(host.ranges).toEqual([]);

    alldebrid.misbehave(undefined);
    downloads.resume(added!.id);
    await finished(downloads, added!.id, DownloadStatus.Completed);
  });

  it('waits for a link the service needs time to prepare, then downloads it', async () => {
    const host = await fileHost({ fileName: 'big.iso' });
    const alldebrid = await serviceWith({
      links: { [LINK]: { direct: host.url, delayedPolls: 3 } },
    });
    const downloads = await open(await connected(alldebrid));

    const [added] = downloads.add({ urls: [LINK] });
    await finished(downloads, added!.id, DownloadStatus.Completed);

    expect(Buffer.compare(await readFile(inDownloads('big.iso')), body)).toBe(0);
    expect(alldebrid.requests.filter((request) => request.url === '/v4/link/delayed')).toHaveLength(
      4,
    );
  });

  it('is paused while the service prepares it, and waits no longer for the service', async () => {
    const host = await fileHost();
    const alldebrid = await serviceWith({
      links: { [LINK]: { direct: host.url, delayedPolls: 1_000_000 } },
    });
    const downloads = await open(await connected(alldebrid));
    const [added] = downloads.add({ urls: [LINK] });
    await until(() => alldebrid.requests.some((request) => request.url === '/v4/link/delayed'));

    const paused = await downloads.pause(added!.id);

    expect(paused.status).toBe(DownloadStatus.Paused);
    expect(paused.failure).toBeNull();
    expect(paused.via).toBe('alldebrid');
    const asked = alldebrid.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The wait above is the case itself: nothing more is asked once it is paused.
    expect(alldebrid.requests.length).toBeLessThanOrEqual(asked + 1);
  });

  it.each([
    ['MUST_BE_PREMIUM', DownloadFailure.NotPremium],
    ['LINK_DOWN', DownloadFailure.LinkDown],
    ['LINK_PASS_PROTECTED', DownloadFailure.LinkPassword],
    ['LINK_HOST_UNAVAILABLE', DownloadFailure.HostUnavailable],
    ['LINK_HOST_LIMIT_REACHED', DownloadFailure.HostLimit],
    ['NO_SERVER', DownloadFailure.NetworkRefused],
    ['LINK_ERROR', DownloadFailure.LinkRefused],
    ['AUTH_BAD_APIKEY', DownloadFailure.KeyRefused],
    ['MAINTENANCE', DownloadFailure.Unavailable],
  ] as const)(
    'fails with what the service said when it answers %s, and fetches nothing',
    async (code, failure) => {
      const host = await fileHost();
      const alldebrid = await serviceWith({ links: { [LINK]: { error: code } } });
      const downloads = await open(await connected(alldebrid));

      const [added] = downloads.add({ urls: [LINK] });
      const failed = await finished(downloads, added!.id, DownloadStatus.Failed);

      expect(failed.failure).toBe(failure);
      expect(failed.via).toBe('alldebrid');
      expect(host.ranges).toEqual([]);
      expect(await readdir(join(folder.path, 'downloads')).catch(() => [])).toEqual([]);
    },
  );

  it('asks the service once for a download that is paused and resumed', async () => {
    const host = await fileHost({ fileName: 'Film.mkv', chunkDelayMs: 5 });
    const alldebrid = await serviceWith({ links: { [LINK]: { direct: host.url } } });
    const downloads = await open(await connected(alldebrid));
    const [added] = downloads.add({ urls: [LINK] });
    await until(() => downloads.find(added!.id).downloadedBytes > 0);

    await downloads.pause(added!.id);
    downloads.resume(added!.id);
    await finished(downloads, added!.id, DownloadStatus.Completed);

    expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), body)).toBe(0);
    expect(unlocks(alldebrid)).toHaveLength(1);
  });

  it('goes on with the link it was given after the engine stops and starts again', async () => {
    const host = await fileHost({ fileName: 'Film.mkv', chunkDelayMs: 5 });
    const alldebrid = await serviceWith({ links: { [LINK]: { direct: host.url } } });
    const vault = new MemoryVault();
    const first = await open(await connected(alldebrid, vault));
    const [added] = first.add({ urls: [LINK] });
    await until(() => first.find(added!.id).downloadedBytes > 0);
    await first.close();

    const second = await open(await connected(alldebrid, vault));
    const done = await finished(second, added!.id, DownloadStatus.Completed);

    expect(done.via).toBe('alldebrid');
    expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), body)).toBe(0);
    expect(unlocks(alldebrid)).toHaveLength(1);
  });

  it('asks the service for another link when a failed download is tried again', async () => {
    const gone = await fileHost({ status: 404 });
    const there = await fileHost({ fileName: 'Film.mkv' });
    let direct = gone.url;
    const alldebrid = await serviceWith({
      links: {
        get [LINK]() {
          return { direct };
        },
      },
    });
    const downloads = await open(await connected(alldebrid));
    const [added] = downloads.add({ urls: [LINK] });
    const failed = await finished(downloads, added!.id, DownloadStatus.Failed);
    expect(failed.failure).toBe(DownloadFailure.HttpStatus);

    direct = there.url;
    downloads.resume(added!.id);
    await finished(downloads, added!.id, DownloadStatus.Completed);

    expect(unlocks(alldebrid)).toHaveLength(2);
    expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), body)).toBe(0);
  });

  it('says the service is no longer connected, and fetches nothing, for a link that was its own', async () => {
    const host = await fileHost();
    const alldebrid = await serviceWith({ links: { [LINK]: { error: 'LINK_HOST_UNAVAILABLE' } } });
    const integrations = await connected(alldebrid);
    const downloads = await open(integrations);
    const [added] = downloads.add({ urls: [LINK] });
    await finished(downloads, added!.id, DownloadStatus.Failed);

    await integrations.disconnect(IntegrationId.AllDebrid);
    downloads.resume(added!.id);
    const failed = await finished(downloads, added!.id, DownloadStatus.Failed);

    expect(failed.failure).toBe(DownloadFailure.NotConnected);
    expect(failed.via).toBe('alldebrid');
    expect(host.ranges).toEqual([]);
  });

  it('names the file as the host of the direct link does, and else as the service does', async () => {
    const named = await fileHost({ fileName: 'from-the-host.mkv' });
    const unnamed = await fileHost();
    const other = 'https://hoster.example/f/other';
    const alldebrid = await serviceWith({
      links: {
        [LINK]: { direct: named.url, filename: 'from-the-service.mkv' },
        [other]: { direct: unnamed.url, filename: 'from-the-service.mkv' },
      },
    });
    const downloads = await open(await connected(alldebrid));

    const [first, second] = downloads.add({ urls: [LINK, other] });
    await finished(downloads, first!.id, DownloadStatus.Completed);
    await finished(downloads, second!.id, DownloadStatus.Completed);

    expect(downloads.find(first!.id).fileName).toBe('from-the-host.mkv');
    expect(downloads.find(second!.id).fileName).toBe('from-the-service.mkv');
  });

  it('treats the name a service gives as any name from a host: no path, nothing the disk refuses', async () => {
    const host = await fileHost();
    const alldebrid = await serviceWith({
      links: { [LINK]: { direct: host.url, filename: '..\\..\\Start Menu/evil:name?.exe' } },
    });
    const downloads = await open(await connected(alldebrid));

    const [added] = downloads.add({ urls: [LINK] });
    const done = await finished(downloads, added!.id, DownloadStatus.Completed);

    expect(done.fileName).toBe('evil_name_.exe');
    expect(await readdir(join(folder.path, 'downloads'))).toEqual(['evil_name_.exe']);
  });

  it('does not tell the host a service sent it to which page the link was on', async () => {
    const seen: (string | undefined)[] = [];
    const host = await fileHost();
    const spying: typeof source = Object.create(source) as typeof source;
    spying.probe = (url, headers, signal) => {
      seen.push(headers.referer);
      return source.probe(url, headers, signal);
    };
    spying.open = (url, headers, range, signal) => {
      seen.push(headers.referer);
      return source.open(url, headers, range, signal);
    };
    const alldebrid = await serviceWith({ links: { [LINK]: { direct: host.url } } });
    manager = await DownloadManager.open({
      source: spying,
      store: new JsonStateStore(statePath()),
      defaultDirectory: join(folder.path, 'downloads'),
      logger,
      resolver: await connected(alldebrid),
    });

    const [added] = manager.add({ urls: [LINK], referrer: 'https://forum.example/thread/7' });
    await finished(manager, added!.id, DownloadStatus.Completed);

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((referer) => referer === undefined)).toBe(true);
  });

  it('keeps the link the service gave in the state, and out of the log and of what the API shows', async () => {
    const host = await fileHost({ fileName: 'Film.mkv', status: 404 });
    const alldebrid = await serviceWith({ links: { [LINK]: { direct: host.url } } });
    const downloads = await open(await connected(alldebrid));

    const [added] = downloads.add({ urls: [LINK] });
    await finished(downloads, added!.id, DownloadStatus.Failed);
    await downloads.close();

    expect(await readFile(statePath(), 'utf8')).toContain(host.url);
    expect(JSON.stringify(downloads.snapshot())).not.toContain(host.url);
    expect(logged.join('\n')).toContain('download_failed');
    expect(logged.join('\n')).not.toContain(host.url);
    expect(logged.join('\n')).not.toContain(KEY);
  });

  it('loads a state written before services existed, and fetches its links as they stand', async () => {
    const host = await fileHost({ fileName: 'old.bin' });
    mkdirSync(join(folder.path, 'data'), { recursive: true });
    await writeFile(
      statePath(),
      JSON.stringify({
        version: 1,
        settings: {
          maxConcurrentDownloads: 3,
          connectionsPerDownload: 8,
          downloadDirectory: join(folder.path, 'downloads'),
          speedLimitBytesPerSecond: null,
        },
        downloads: [
          {
            id: 'from-before',
            url: host.url,
            referrer: null,
            directory: join(folder.path, 'downloads'),
            fileName: 'old.bin',
            named: false,
            status: DownloadStatus.Queued,
            totalBytes: null,
            resumable: false,
            validator: null,
            segments: [],
            downloadedBytes: 0,
            failure: null,
            failureStatus: null,
            createdAt: '2026-11-19T10:00:00.000Z',
            completedAt: null,
          },
        ],
      }),
    );

    const downloads = await open(undefined);
    const done = await finished(downloads, 'from-before', DownloadStatus.Completed);

    expect(done.via).toBeNull();
    expect(Buffer.compare(await readFile(inDownloads('old.bin')), body)).toBe(0);
  });
});
