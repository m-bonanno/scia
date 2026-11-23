import { randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type IntegrationAccount, IntegrationId } from '@scia/contracts';
import { DownloadFailure, DownloadStatus, ServiceFailure, UnlockFailure } from '@scia/core';
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

  const hostsFile = () => join(folder.path, 'data', 'alldebrid-hosts.json');
  async function connected(to: AllDebridServer, vault = new MemoryVault()): Promise<Integrations> {
    await vault.write(IntegrationId.AllDebrid, KEY);
    return Integrations.open({
      vault,
      hostsFile: hostsFile(),
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

  describe('while the kept key cannot be read (#69)', () => {
    const never = new AbortController().signal;
    // Main answers that it could not read the key: the system no longer has what opens it.
    async function keyNotRead(to: AllDebridServer): Promise<Integrations> {
      const vault = new MemoryVault();
      return Integrations.open({
        vault: {
          read: () => Promise.reject(new Error('Main did not read the key of alldebrid.')),
          write: (name, key) => vault.write(name, key),
          remove: (name) => vault.remove(name),
        },
        hostsFile: hostsFile(),
        alldebrid: new AllDebrid({ api: to.api, userAgent: 'Scia/spec', retryDelayMs: () => 1 }),
        logger,
      });
    }
    // The list the account gave in the run before, kept: the public list does not have the host.
    async function keptList(): Promise<void> {
      mkdirSync(join(folder.path, 'data'), { recursive: true });
      await writeFile(hostsFile(), JSON.stringify({ domains: ['hoster.example'] }));
    }

    it("says a link of the account's hosts needs the service, and fetches nothing from its host", async () => {
      await keptList();
      const alldebrid = await serviceWith({ hosts: {}, links: {} });
      // Not even the public list answers: the kept one is what knows the host.
      alldebrid.misbehave({ status: 503, route: 'GET /v4/hosts/domains' });
      const downloads = await open(await keyNotRead(alldebrid));

      const [added] = downloads.add({ urls: [LINK] });
      const failed = await finished(downloads, added!.id, DownloadStatus.Failed);

      expect(failed.failure).toBe(UnlockFailure.NeedsService);
      expect(failed.via).toBeNull();
      expect(existsSync(inDownloads('abc123'))).toBe(false);
      expect(alldebrid.requests.every((request) => request.authorization === undefined)).toBe(true);
    });

    it("takes for the account's host its own domain and its www, as with no service", async () => {
      await keptList();
      const alldebrid = await serviceWith({ hosts: {}, links: {} });
      const integrations = await keyNotRead(alldebrid);
      const needsService = { failure: UnlockFailure.NeedsService };

      await expect(
        integrations.serviceFor('https://www.hoster.example/f/1', never),
      ).rejects.toMatchObject(needsService);
      expect(await integrations.serviceFor('https://dl42.hoster.example/f/1', never)).toBe(
        undefined,
      );
    });

    it('goes by the public list alone when no key was kept, whatever list was left behind', async () => {
      // A list a disconnection could not remove: it is no account's any more.
      await keptList();
      const alldebrid = await serviceWith({ hosts: {}, links: {} });
      const integrations = await Integrations.open({
        vault: new MemoryVault(),
        hostsFile: hostsFile(),
        alldebrid: new AllDebrid({ api: alldebrid.api, userAgent: 'Scia/spec' }),
        logger,
      });

      expect(await integrations.serviceFor(LINK, never)).toBeUndefined();
    });

    it('fetches as it stands a link of no host either list has', async () => {
      await keptList();
      const host = await fileHost({ fileName: 'direct.bin' });
      const alldebrid = await serviceWith({ hosts: {}, links: {} });
      const downloads = await open(await keyNotRead(alldebrid));

      const [added] = downloads.add({ urls: [host.url] });
      const done = await finished(downloads, added!.id, DownloadStatus.Completed);

      expect(done.via).toBeNull();
      expect(Buffer.compare(await readFile(inDownloads('direct.bin')), body)).toBe(0);
    });

    it('goes through the service once a key is connected again', async () => {
      await keptList();
      const host = await fileHost({ fileName: 'Film.mkv' });
      const alldebrid = await serviceWith({ links: { [LINK]: { direct: host.url } } });
      const integrations = await keyNotRead(alldebrid);
      const downloads = await open(integrations);

      await integrations.connect(IntegrationId.AllDebrid, KEY);
      const [added] = downloads.add({ urls: [LINK] });
      const done = await finished(downloads, added!.id, DownloadStatus.Completed);

      expect(done.via).toBe('alldebrid');
    });
  });

  describe('while no service is connected', () => {
    const never = new AbortController().signal;
    const publicListAsked = (of: AllDebridServer) =>
      of.requests.filter((request) => request.url === '/v4/hosts/domains').length;
    async function noneConnected(to: AllDebridServer, now?: () => number): Promise<Integrations> {
      return Integrations.open({
        vault: new MemoryVault(),
        alldebrid: new AllDebrid({ api: to.api, userAgent: 'Scia/spec', retryDelayMs: () => 1 }),
        logger,
        ...(now === undefined ? {} : { now }),
      });
    }

    it("says a file host's link needs a service, and fetches nothing from its host", async () => {
      const alldebrid = await serviceWith({ links: {} });
      const downloads = await open(await noneConnected(alldebrid));

      const [added] = downloads.add({ urls: [LINK] });
      const failed = await finished(downloads, added!.id, DownloadStatus.Failed);

      expect(failed.failure).toBe(UnlockFailure.NeedsService);
      expect(failed.via).toBeNull();
      expect(existsSync(inDownloads('abc123'))).toBe(false);
      // The service was asked for the hosts it supports, with no key and nothing of the link.
      expect(alldebrid.requests.map((request) => request.url)).toEqual(['/v4/hosts/domains']);
      expect(alldebrid.requests[0]?.authorization).toBeUndefined();
      expect(JSON.stringify(alldebrid.requests)).not.toContain('abc123');
    });

    it('fetches any other link as it stands, and tells the service nothing of it', async () => {
      const host = await fileHost({ fileName: 'direct.bin' });
      const alldebrid = await serviceWith({ links: {} });
      const downloads = await open(await noneConnected(alldebrid));

      const [added] = downloads.add({ urls: [host.url] });
      const done = await finished(downloads, added!.id, DownloadStatus.Completed);

      expect(done.via).toBeNull();
      expect(Buffer.compare(await readFile(inDownloads('direct.bin')), body)).toBe(0);
      expect(JSON.stringify(alldebrid.requests)).not.toContain(host.url);
    });

    it('takes for a file host only its own domain and its www, not the servers of its files', async () => {
      const alldebrid = await serviceWith({ links: {} });
      const integrations = await noneConnected(alldebrid);
      const needsService = { failure: UnlockFailure.NeedsService };

      await expect(integrations.serviceFor(LINK, never)).rejects.toMatchObject(needsService);
      await expect(
        integrations.serviceFor('https://WWW.Hoster.example/f/1', never),
      ).rejects.toMatchObject(needsService);
      for (const other of [
        // A file's own server, which serves it to anyone: a direct link.
        'https://dl42.hoster.example/files/film.mkv',
        'https://nothoster.example/f/1',
        'https://hoster.example.evil.test/f/1',
        'https://evil.test/?u=hoster.example',
        'not an address',
      ]) {
        expect(await integrations.serviceFor(other, never), other).toBeUndefined();
      }
    });

    it('takes no site of videos and no shortener of links for a file host', async () => {
      const alldebrid = await serviceWith({
        links: {},
        streams: ['videos.example'],
        redirectors: ['short.example'],
      });
      const integrations = await noneConnected(alldebrid);

      expect(
        await integrations.serviceFor('https://videos.example/watch?v=1', never),
      ).toBeUndefined();
      expect(await integrations.serviceFor('https://short.example/abc', never)).toBeUndefined();
    });

    it('reads the list once for the links that wait, and again after six hours', async () => {
      const alldebrid = await serviceWith({ links: {} });
      let clock = 0;
      // Counted where a reading starts: a reading again goes on behind the links, unseen.
      let readings = 0;
      let last: Promise<unknown> = Promise.resolve();
      class Counting extends AllDebrid {
        override publicDomains(signal?: AbortSignal): Promise<string[]> {
          readings += 1;
          const reading = super.publicDomains(signal);
          last = reading.catch(() => undefined);
          return reading;
        }
      }
      const integrations = await Integrations.open({
        vault: new MemoryVault(),
        alldebrid: new Counting({ api: alldebrid.api, userAgent: 'Scia/spec' }),
        logger,
        now: () => clock,
      });
      const ask = () => integrations.serviceFor('https://elsewhere.example/f', never);
      // The last reading answered, and what the engine does with the answer done.
      const settled = async () => {
        await last;
        await new Promise((resolve) => setImmediate(resolve));
      };

      await Promise.all([ask(), ask(), ask()]);
      clock += 6 * 60 * 60_000 - 1;
      await ask();
      expect(readings).toBe(1);

      clock += 1;
      await ask();
      expect(readings).toBe(2);
      await settled();

      // A list that cannot be read again is still the list, also once that reading failed.
      alldebrid.misbehave({ status: 503 });
      clock += 6 * 60 * 60_000;
      const needsService = { failure: UnlockFailure.NeedsService };
      await expect(integrations.serviceFor(LINK, never)).rejects.toMatchObject(needsService);
      await settled();
      await expect(integrations.serviceFor(LINK, never)).rejects.toMatchObject(needsService);
      expect(readings).toBe(3);

      // A refresh that failed is asked again an hour later, not sooner.
      clock += 60 * 60_000 - 1;
      await ask();
      expect(readings).toBe(3);
      clock += 1;
      await ask();
      expect(readings).toBe(4);
    });

    it('fetches a link as it stands while the list cannot be read, and asks again an hour later', async () => {
      const alldebrid = await serviceWith({ links: {} });
      let clock = 0;
      const integrations = await noneConnected(alldebrid, () => clock);
      alldebrid.misbehave({ status: 503 });

      // Not stopped on a guess: with no service, a link went as it stands before #49.
      expect(await integrations.serviceFor(LINK, never)).toBeUndefined();
      expect(logged.join('\n')).toContain('service_public_hosts_not_read');
      const afterTheFailure = publicListAsked(alldebrid);

      clock += 60 * 60_000 - 1;
      await integrations.serviceFor(LINK, never);
      expect(publicListAsked(alldebrid)).toBe(afterTheFailure);

      alldebrid.misbehave(undefined);
      clock += 1;
      await expect(integrations.serviceFor(LINK, never)).rejects.toMatchObject({
        failure: UnlockFailure.NeedsService,
      });
    });

    it('goes by the service connected while the public list was being read', async () => {
      const alldebrid = await serviceWith({ links: {} });
      let answer: ((domains: string[]) => void) | undefined;
      class Holding extends AllDebrid {
        override publicDomains(): Promise<string[]> {
          return new Promise((resolve) => {
            answer = resolve;
          });
        }
      }
      const integrations = await Integrations.open({
        vault: new MemoryVault(),
        alldebrid: new Holding({ api: alldebrid.api, userAgent: 'Scia/spec' }),
        logger,
      });
      const asked = integrations.serviceFor(LINK, never);
      await until(() => answer !== undefined);

      await integrations.connect(IntegrationId.AllDebrid, KEY);
      answer?.(['hoster.example']);

      expect(await asked).toBe('alldebrid');
    });

    it('goes on by the list it has while it reads it again: nobody waits on a refresh', async () => {
      const alldebrid = await serviceWith({ links: {} });
      let clock = 0;
      let readings = 0;
      class SlowSecond extends AllDebrid {
        override publicDomains(signal?: AbortSignal): Promise<string[]> {
          readings += 1;
          // The second reading never answers.
          return readings === 1 ? super.publicDomains(signal) : new Promise(() => undefined);
        }
      }
      const integrations = await Integrations.open({
        vault: new MemoryVault(),
        alldebrid: new SlowSecond({ api: alldebrid.api, userAgent: 'Scia/spec' }),
        logger,
        now: () => clock,
      });
      const needsService = { failure: UnlockFailure.NeedsService };
      await expect(integrations.serviceFor(LINK, never)).rejects.toMatchObject(needsService);

      clock += 6 * 60 * 60_000;
      await expect(integrations.serviceFor(LINK, never)).rejects.toMatchObject(needsService);
      // And for the next link, while that reading is still on its way.
      await expect(integrations.serviceFor(LINK, never)).rejects.toMatchObject(needsService);
      expect(readings).toBe(2);
    });

    it('is paused at once while the public list is being read', async () => {
      const host = await fileHost();
      const alldebrid = await serviceWith({ links: {} });
      class Silent extends AllDebrid {
        override publicDomains(): Promise<string[]> {
          return new Promise(() => undefined);
        }
      }
      const downloads = await open(
        await Integrations.open({
          vault: new MemoryVault(),
          alldebrid: new Silent({ api: alldebrid.api, userAgent: 'Scia/spec' }),
          logger,
        }),
      );
      const [added] = downloads.add({ urls: [host.url] });
      await until(() => downloads.find(added!.id).status === DownloadStatus.Downloading);

      const started = performance.now();
      const paused = await downloads.pause(added!.id);

      expect(performance.now() - started).toBeLessThan(2000);
      expect(paused.status).toBe(DownloadStatus.Paused);
      expect(paused.failure).toBeNull();
    });

    it('asks for no public list once a service is connected', async () => {
      const alldebrid = await serviceWith({ links: {} });
      const integrations = await connected(alldebrid);

      await integrations.serviceFor(LINK, never);

      expect(publicListAsked(alldebrid)).toBe(0);
    });

    it('unlocks the link once a service is connected and the download tried again', async () => {
      const host = await fileHost({ fileName: 'Film.mkv' });
      const alldebrid = await serviceWith({ links: { [LINK]: { direct: host.url } } });
      const vault = new MemoryVault();
      const integrations = await Integrations.open({
        vault,
        alldebrid: new AllDebrid({ api: alldebrid.api, userAgent: 'Scia/spec' }),
        logger,
      });
      const downloads = await open(integrations);
      const [added] = downloads.add({ urls: [LINK] });
      await finished(downloads, added!.id, DownloadStatus.Failed);

      await integrations.connect(IntegrationId.AllDebrid, KEY);
      downloads.resume(added!.id);
      const done = await finished(downloads, added!.id, DownloadStatus.Completed);

      expect(done.via).toBe('alldebrid');
      expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), body)).toBe(0);
    });
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
    const afterTheFailure = alldebrid.requests.length;

    // Not asked again for every link while it does not answer: a minute later, it is.
    clock += 59_000;
    await ask();
    expect(alldebrid.requests).toHaveLength(afterTheFailure);
    clock += 2000;
    await ask();
    expect(alldebrid.requests.length).toBeGreaterThan(afterTheFailure);
  });

  it('keeps the last list of hosts it read between runs, and goes by it while the service cannot be asked', async () => {
    const host = await fileHost({ fileName: 'direct.bin' });
    const alldebrid = await serviceWith({ links: {} });
    const vault = new MemoryVault();
    const never = new AbortController().signal;
    expect(await (await connected(alldebrid, vault)).serviceFor(LINK, never)).toBe('alldebrid');

    // The next run: AllDebrid down, or refusing this network.
    alldebrid.misbehave({ error: 'NO_SERVER' });
    const restarted = await connected(alldebrid, vault);

    expect(await restarted.serviceFor(LINK, never)).toBe('alldebrid');
    // A direct link is no hoster's on the kept list: it is fetched as it stands.
    expect(await restarted.serviceFor(host.url, never)).toBeUndefined();
    // The kept list is old: the service was asked again, and its refusal is in the log.
    expect(alldebrid.requests.filter((r) => r.url === '/v4.1/user/hosts')).toHaveLength(2);
    expect(logged.join('\n')).toContain('service_hosts_not_read');
  });

  it("fails on a link while it has never been told which links are the service's", async () => {
    const alldebrid = await serviceWith({ links: {} });
    alldebrid.misbehave({ error: 'NO_SERVER' });
    const integrations = await connected(alldebrid);

    const refused = integrations.serviceFor(LINK, new AbortController().signal);

    await expect(refused).rejects.toMatchObject({ failure: ServiceFailure.NetworkRefused });
  });

  describe('while the list of the first account is being read', () => {
    const OTHER = 'other-key-000000000000000';
    const never = new AbortController().signal;
    let server: AllDebridServer;
    const hostsRead = () => server.requests.filter((r) => r.url === '/v4.1/user/hosts').length;
    let answer: ((domains: string[]) => void) | undefined;
    let refuse: ((error: Error) => void) | undefined;

    // AllDebrid as it is, but for the first account: its list is answered when the spec says,
    // and the other account is accepted without a word, so that nothing stands between the
    // answer and a change of key.
    async function heldForTheFirstKey(): Promise<Integrations> {
      answer = undefined;
      refuse = undefined;
      server = await serviceWith({
        accounts: {
          [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL, hosts: ['hoster'] },
          [OTHER]: { username: 'grace', premiumUntil: PREMIUM_UNTIL, hosts: ['elsewhere'] },
        },
        hosts: { hoster: ['hoster.example'], elsewhere: ['elsewhere.example'] },
        links: {},
      });
      class Holding extends AllDebrid {
        override account(apiKey: string): Promise<IntegrationAccount> {
          if (apiKey !== OTHER) return super.account(apiKey);
          return Promise.resolve({ name: 'grace', premium: true, premiumUntil: null });
        }
        override domains(apiKey: string, signal?: AbortSignal): Promise<string[]> {
          if (apiKey !== KEY) return super.domains(apiKey, signal);
          return new Promise((resolve, reject) => {
            answer = resolve;
            refuse = reject;
          });
        }
      }
      const vault = new MemoryVault();
      await vault.write(IntegrationId.AllDebrid, KEY);
      return Integrations.open({
        vault,
        hostsFile: hostsFile(),
        alldebrid: new Holding({ api: server.api, userAgent: 'Scia/spec', retryDelayMs: () => 1 }),
        logger,
      });
    }

    it('keeps no list behind a disconnection that comes as the list is answered', async () => {
      const integrations = await heldForTheFirstKey();
      const reading = integrations.serviceFor(LINK, never);
      await until(() => answer !== undefined);

      answer?.(['hoster.example']);
      await integrations.disconnect(IntegrationId.AllDebrid);
      await reading;

      expect(existsSync(hostsFile())).toBe(false);
    });

    it('keeps no list of the first account once another is connected as it is answered', async () => {
      const integrations = await heldForTheFirstKey();
      const reading = integrations.serviceFor(LINK, never);
      await until(() => answer !== undefined);

      answer?.(['hoster.example']);
      await integrations.connect(IntegrationId.AllDebrid, OTHER);
      await reading;

      expect(existsSync(hostsFile())).toBe(false);
    });

    it('does not take the kept list of the first account for the one connected while it was asked', async () => {
      mkdirSync(join(folder.path, 'data'), { recursive: true });
      await writeFile(hostsFile(), JSON.stringify({ domains: ['hoster.example'] }));
      const integrations = await heldForTheFirstKey();
      const reading = integrations.serviceFor(LINK, never);
      await until(() => refuse !== undefined);

      await integrations.connect(IntegrationId.AllDebrid, OTHER);
      refuse?.(new Error('the service did not answer'));
      // The first account's download goes by its own kept list.
      expect(await reading).toBe('alldebrid');

      expect(await integrations.serviceFor('https://elsewhere.example/f/1', never)).toBe(
        'alldebrid',
      );
    });

    it('asks once for the list of the account connected next, whatever the reading before it does', async () => {
      const integrations = await heldForTheFirstKey();
      const first = integrations.serviceFor(LINK, never).catch(() => undefined);
      await until(() => refuse !== undefined);
      await integrations.connect(IntegrationId.AllDebrid, OTHER);
      server.misbehave({ slowMs: 300, times: 1 });
      const one = integrations.serviceFor('https://elsewhere.example/f/1', never);
      await until(() => hostsRead() === 1);

      // The reading under the first key ends while the next one is on its way.
      refuse?.(new Error('the service did not answer'));
      await first;
      const two = integrations.serviceFor('https://elsewhere.example/f/2', never);

      expect(await one).toBe('alldebrid');
      expect(await two).toBe('alldebrid');
      expect(hostsRead()).toBe(1);
    });
  });

  it('forgets the kept list when another account is connected, and when none is', async () => {
    const alldebrid = await serviceWith({ links: {} });
    const integrations = await connected(alldebrid);
    await integrations.serviceFor(LINK, new AbortController().signal);
    expect(existsSync(hostsFile())).toBe(true);

    await integrations.connect(IntegrationId.AllDebrid, KEY);
    expect(existsSync(hostsFile())).toBe(false);
    await integrations.serviceFor(LINK, new AbortController().signal);
    expect(existsSync(hostsFile())).toBe(true);

    await integrations.disconnect(IntegrationId.AllDebrid);
    expect(existsSync(hostsFile())).toBe(false);
  });

  it('goes by the hosts of the account connected now, not by a reading started under the key before', async () => {
    const other = 'other-key-000000000000000';
    const alldebrid = await serviceWith({
      accounts: {
        [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL, hosts: ['hoster'] },
        [other]: { username: 'grace', premiumUntil: PREMIUM_UNTIL, hosts: ['elsewhere'] },
      },
      hosts: { hoster: ['hoster.example'], elsewhere: ['elsewhere.example'] },
      links: {},
    });
    const integrations = await connected(alldebrid);
    const never = new AbortController().signal;
    // The first account's list is slow to come; the second account is connected meanwhile.
    alldebrid.misbehave({ slowMs: 300, times: 1 });
    const underTheFirstKey = integrations.serviceFor(LINK, never);
    await until(() => alldebrid.requests.some((r) => r.url === '/v4.1/user/hosts'));
    await integrations.connect(IntegrationId.AllDebrid, other);

    const elsewhere = await integrations.serviceFor('https://elsewhere.example/f/1', never);
    await underTheFirstKey;

    expect(elsewhere).toBe('alldebrid');
    // The first account's list came last, and is not taken for the second's.
    expect(await integrations.serviceFor('https://elsewhere.example/f/2', never)).toBe('alldebrid');
    expect(await integrations.serviceFor(LINK, never)).toBeUndefined();
  });

  it('reads the hosts again for the account that is connected next', async () => {
    const alldebrid = await serviceWith({ links: {} });
    const integrations = await connected(alldebrid);
    const never = new AbortController().signal;
    const hostsRead = () => alldebrid.requests.filter((r) => r.url === '/v4.1/user/hosts').length;
    await integrations.serviceFor(LINK, never);
    expect(hostsRead()).toBe(1);

    await integrations.connect(IntegrationId.AllDebrid, KEY);
    await integrations.serviceFor(LINK, never);
    expect(hostsRead()).toBe(2);

    await integrations.disconnect(IntegrationId.AllDebrid);
    await integrations.connect(IntegrationId.AllDebrid, KEY);
    await integrations.serviceFor(LINK, never);
    expect(hostsRead()).toBe(3);
  });

  it('is paused at once while the service is slow to say which links are its own', async () => {
    const host = await fileHost();
    const alldebrid = await serviceWith({ links: {} });
    alldebrid.misbehave({ silent: true });
    const vault = new MemoryVault();
    await vault.write(IntegrationId.AllDebrid, KEY);
    const downloads = await open(
      await Integrations.open({
        vault,
        // Ten seconds for an answer, three times: a pause that waited for it would wait as long.
        alldebrid: new AllDebrid({ api: alldebrid.api, userAgent: 'Scia/spec' }),
        logger,
      }),
    );
    const [added] = downloads.add({ urls: [host.url] });
    await until(() => alldebrid.requests.length > 0);

    const started = performance.now();
    const paused = await downloads.pause(added!.id);

    expect(performance.now() - started).toBeLessThan(2000);
    expect(paused.status).toBe(DownloadStatus.Paused);
    expect(paused.failure).toBeNull();
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
