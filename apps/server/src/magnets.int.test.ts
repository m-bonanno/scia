import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IntegrationId } from '@scia/contracts';
import {
  DownloadStatus,
  MagnetFailure,
  MagnetStage,
  MagnetStatus,
  UnlockFailure,
} from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllDebrid } from './alldebrid.ts';
import { DownloadManager, ManagerRefusal } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { Integrations } from './integrations.ts';
import { MemoryVault } from './key-vault.ts';
import type { Logger } from './logger.ts';
import { JsonStateStore, type PersistedState, type StateStore } from './state-store.ts';
import {
  type AllDebridServer,
  type AllDebridServerOptions,
  type SimulatedMagnet,
  startAllDebridServer,
} from './testing/alldebrid-server.ts';
import { type RangeServer, startRangeServer } from './testing/range-server.ts';
import { scratchFolder, until } from './testing/scratch.ts';

// Made up: no account anywhere has this key, and no torrent has these hashes.
const KEY = 'spec-key-0000000000000000';
const PREMIUM_UNTIL = Date.UTC(2027, 5, 30, 12) / 1000;
const HASH = '842783e3005495d5d1637f5364b59343c7844707';
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Holiday%20films`;
const OTHER = `magnet:?xt=urn:btih:${'b'.repeat(40)}`;

// A pasted magnet, from the paste to its files on disk: the manager, the services, AllDebrid's
// client and the downloader, against the simulated service and real local hosts.
describe('a magnet that goes through a service', () => {
  const source = new HttpSource('scia-test');
  const readme = randomBytes(5000);
  const film = randomBytes(300_000);
  const extra = randomBytes(9000);
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let hosts: RangeServer[];
  let service: AllDebridServer | undefined;
  let manager: DownloadManager | undefined;
  let logged: string[];
  let logger: Logger;

  beforeEach(async () => {
    folder = await scratchFolder();
    hosts = await Promise.all([readme, film, extra].map((body) => startRangeServer({ body })));
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
    await Promise.all(hosts.map((host) => host.close()));
    await folder.remove();
  });

  // Its files: one at its root, one in a folder, one deeper — each an AllDebrid link the service
  // unlocks into one of the local hosts.
  function holiday(options: Partial<SimulatedMagnet> = {}): SimulatedMagnet {
    return {
      name: 'Holiday films',
      size: readme.length + film.length + extra.length,
      fetchingPolls: 2,
      files: [
        { n: 'readme.txt', s: readme.length, l: 'https://alldebrid.com/f/readme' },
        {
          n: 'Day 1',
          e: [
            { n: 'beach.mkv', s: film.length, l: 'https://alldebrid.com/f/beach' },
            {
              n: 'Extras',
              e: [{ n: 'notes.nfo', s: extra.length, l: 'https://alldebrid.com/f/notes' }],
            },
          ],
        },
      ],
      ...options,
    };
  }

  async function serviceWith(
    options: Partial<AllDebridServerOptions> = {},
  ): Promise<AllDebridServer> {
    const [one, two, three] = hosts;
    service = await startAllDebridServer({
      accounts: {
        [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL },
        'free-key-0000000000000000': { username: 'bob' },
      },
      hosts: { alldebrid: ['alldebrid.com'] },
      links: {
        'https://alldebrid.com/f/readme': { direct: one?.url ?? '', filename: 'readme.txt' },
        'https://alldebrid.com/f/beach': { direct: two?.url ?? '', filename: 'something-else.mkv' },
        'https://alldebrid.com/f/notes': { direct: three?.url ?? '', filename: 'notes.nfo' },
      },
      magnets: { [HASH]: holiday() },
      ...options,
    });
    return service;
  }

  async function connected(to: AllDebridServer, key = KEY): Promise<Integrations> {
    const vault = new MemoryVault();
    await vault.write(IntegrationId.AllDebrid, key);
    return Integrations.open({
      vault,
      alldebrid: new AllDebrid({ api: to.api, userAgent: 'Scia/spec', retryDelayMs: () => 1 }),
      logger,
    });
  }

  const statePath = () => join(folder.path, 'data', 'state.json');
  const downloads = () => join(folder.path, 'downloads');
  async function open(
    integrations: Integrations | undefined,
    store: StateStore = new JsonStateStore(statePath()),
  ): Promise<DownloadManager> {
    manager = await DownloadManager.open({
      source,
      store,
      defaultDirectory: downloads(),
      logger,
      retryDelayMs: () => 1,
      magnetPollMs: 5,
      ...(integrations === undefined ? {} : { resolver: integrations, magnets: integrations }),
    });
    return manager;
  }
  function allDone(of: DownloadManager): boolean {
    const { downloads: all } = of.snapshot();
    return all.length === 3 && all.every((each) => each.status === DownloadStatus.Completed);
  }

  it('sends a pasted magnet to the service, and downloads its files in its folder, their folders rebuilt', async () => {
    const alldebrid = await serviceWith();
    const scia = await open(await connected(alldebrid));

    const [added] = scia.addMagnets([MAGNET]);

    expect(added).toMatchObject({
      name: 'Holiday films',
      status: MagnetStatus.Sending,
      failure: null,
    });
    // Asked about once it was taken: what the service has of it, and how fast.
    await until(() => (scia.snapshot().magnets[0]?.bytesPerSecond ?? 0) > 0);
    expect(scia.snapshot().magnets[0]).toMatchObject({
      totalBytes: holiday().size,
      downloadedBytes: Math.floor(holiday().size / 2),
      bytesPerSecond: 1_048_576,
    });
    await until(() => allDone(scia));

    expect(scia.snapshot().magnets).toEqual([]);
    const root = join(downloads(), 'Holiday films');
    expect(Buffer.compare(await readFile(join(root, 'readme.txt')), readme)).toBe(0);
    // The magnet's own name for its file, not the one its link's host gives.
    expect(Buffer.compare(await readFile(join(root, 'Day 1', 'beach.mkv')), film)).toBe(0);
    expect(Buffer.compare(await readFile(join(root, 'Day 1', 'Extras', 'notes.nfo')), extra)).toBe(
      0,
    );
    expect(scia.snapshot().downloads.every((each) => each.via === 'alldebrid')).toBe(true);
    // One upload, and one question at a time about where the magnet is.
    expect(
      alldebrid.requests.filter((request) => request.url === '/v4/magnet/upload'),
    ).toHaveLength(1);
  });

  it('takes a magnet already in the list once', () => {
    return (async () => {
      const scia = await open(await connected(await serviceWith()));

      scia.addMagnets([MAGNET]);
      const again = scia.addMagnets([MAGNET.toUpperCase().replace('MAGNET:', 'magnet:'), OTHER]);

      expect(again).toHaveLength(1);
      expect(scia.snapshot().magnets).toHaveLength(2);
    })();
  });

  it('says that magnets need a service when none is connected, and sends it once one is, at Retry', async () => {
    const alldebrid = await serviceWith();
    const integrations = await Integrations.open({
      vault: new MemoryVault(),
      alldebrid: new AllDebrid({
        api: alldebrid.api,
        userAgent: 'Scia/spec',
        retryDelayMs: () => 1,
      }),
      logger,
    });
    const scia = await open(integrations);

    const [added] = scia.addMagnets([MAGNET]);
    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);

    expect(scia.snapshot().magnets[0]?.failure).toBe(MagnetFailure.NeedsService);
    expect(alldebrid.requests).toEqual([]);
    await integrations.connect(IntegrationId.AllDebrid, KEY);
    scia.retryMagnet(added?.id ?? '');
    await until(() => allDone(scia));
    expect(
      alldebrid.requests.filter((request) => request.url === '/v4/magnet/upload'),
    ).toHaveLength(1);
  });

  it('says it with no service at all to ask', async () => {
    const scia = await open(undefined);

    scia.addMagnets([MAGNET]);

    await until(() => scia.snapshot().magnets[0]?.failure === MagnetFailure.NeedsService);
  });

  it('says why the service refuses a magnet, and fetches the others of the same paste', async () => {
    const alldebrid = await serviceWith({
      magnets: {
        [HASH]: holiday(),
        ['b'.repeat(40)]: { ...holiday(), error: 'MAGNET_TOO_MANY_ACTIVE' },
      },
    });
    const scia = await open(await connected(alldebrid));

    scia.addMagnets([OTHER, MAGNET]);

    await until(() => allDone(scia));
    expect(scia.snapshot().magnets).toMatchObject([
      { status: MagnetStatus.Failed, failure: MagnetFailure.Limit },
    ]);
  });

  it('says a magnet failed when the service could not fetch it, and that an account not premium cannot send one', async () => {
    const failing = await serviceWith({ magnets: { [HASH]: holiday({ fails: true }) } });
    const scia = await open(await connected(failing));
    scia.addMagnets([MAGNET]);
    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);
    expect(scia.snapshot().magnets[0]?.failure).toBe(MagnetFailure.Failed);
    await manager?.close();
    await failing.close();
    await folder.remove();
    folder = await scratchFolder();

    const free = await open(await connected(await serviceWith(), 'free-key-0000000000000000'));
    free.addMagnets([MAGNET]);
    await until(() => free.snapshot().magnets[0]?.status === MagnetStatus.Failed);
    expect(free.snapshot().magnets[0]?.failure).toBe(MagnetFailure.NotPremium);
  });

  it('goes on waiting for a magnet after a restart, without sending it again', async () => {
    const alldebrid = await serviceWith({ magnets: { [HASH]: holiday({ fetchingPolls: 1000 }) } });
    const integrations = await connected(alldebrid);
    const first = await open(integrations);
    first.addMagnets([MAGNET]);
    await until(() => first.snapshot().magnets[0]?.status === MagnetStatus.Fetching);
    await first.close();

    const again = await open(integrations);

    expect(again.snapshot().magnets).toMatchObject([
      { name: 'Holiday films', status: MagnetStatus.Fetching },
    ]);
    const asked = alldebrid.requests.length;
    await until(() => alldebrid.requests.length > asked + 1);
    expect(
      alldebrid.requests.filter((request) => request.url === '/v4/magnet/upload'),
    ).toHaveLength(1);
  });

  it('stops waiting for a magnet that is removed, and keeps nothing of it', async () => {
    const alldebrid = await serviceWith({ magnets: { [HASH]: holiday({ fetchingPolls: 1000 }) } });
    const scia = await open(await connected(alldebrid));
    const [added] = scia.addMagnets([MAGNET]);
    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Fetching);

    scia.removeMagnet(added?.id ?? '');

    expect(scia.snapshot().magnets).toEqual([]);
    await scia.close();
    expect(await readFile(statePath(), 'utf8')).not.toContain(HASH);
  });

  it("takes the service's name for a magnet once the service has read it", async () => {
    const alldebrid = await serviceWith({
      magnets: { [HASH]: holiday({ nameAtUpload: 'noname', fetchingPolls: 1000 }) },
    });
    const scia = await open(await connected(alldebrid));

    scia.addMagnets([`magnet:?xt=urn:btih:${HASH}`]);

    expect(scia.snapshot().magnets[0]?.name).toBe(HASH);
    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Fetching);
    await until(() => scia.snapshot().magnets[0]?.name === 'Holiday films');
  });

  it('waits on while the service cannot be asked for a while, and says so meanwhile', async () => {
    const alldebrid = await serviceWith();
    alldebrid.misbehave({ status: 503, times: 12 });
    const scia = await open(await connected(alldebrid));

    scia.addMagnets([MAGNET]);

    await until(() => scia.snapshot().magnets[0]?.failure === MagnetFailure.Unavailable);
    expect(scia.snapshot().magnets[0]?.status).toBe(MagnetStatus.Sending);
    await until(() => allDone(scia));
    // Twelve refusals and three downloads: once more than vitest's five seconds on CI's Windows.
  }, 20_000);

  it('fails a magnet whose files the service answers with a code Scia does not know, as its upload would', async () => {
    const alldebrid = await serviceWith({
      magnets: { [HASH]: holiday({ unknownFilesAnswers: 1 }) },
    });
    const scia = await open(await connected(alldebrid));

    scia.addMagnets([MAGNET]);

    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);
    expect(scia.snapshot().magnets[0]?.failure).toBe(MagnetFailure.Unavailable);
    expect(scia.snapshot().downloads).toEqual([]);
  });

  it('says a magnet failed when it is gone from the account', async () => {
    const alldebrid = await serviceWith({ magnets: { [HASH]: holiday({ fetchingPolls: 1000 }) } });
    const scia = await open(await connected(alldebrid));
    scia.addMagnets([MAGNET]);
    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Fetching);

    alldebrid.forgetMagnets();

    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);
    expect(scia.snapshot().magnets[0]).toMatchObject({
      failure: MagnetFailure.Failed,
      bytesPerSecond: 0,
    });
  });

  it('makes no downloads of a magnet removed while its files were asked for', async () => {
    const alldebrid = await serviceWith({ magnets: { [HASH]: holiday({ fetchingPolls: 0 }) } });
    const scia = await open(await connected(alldebrid));
    // Sent, where it is, then its files: each slow to come.
    alldebrid.misbehave({ slowMs: 300, times: 3 });
    const [added] = scia.addMagnets([MAGNET]);
    await until(() => alldebrid.requests.some((request) => request.url === '/v4/magnet/files'));

    scia.removeMagnet(added?.id ?? '');

    // The files come 300 ms after they were asked for: without the magnet, they make nothing.
    await expect(until(() => scia.snapshot().downloads.length > 0, 1000)).rejects.toThrow(
      'never held',
    );
  });

  it('asks the service nothing more once no magnet waits', async () => {
    const alldebrid = await serviceWith();
    const scia = await open(await connected(alldebrid));
    scia.addMagnets([MAGNET]);
    await until(() => allDone(scia));
    const asked = alldebrid.requests.filter((request) => request.url.includes('/magnet/')).length;

    // Nothing runs, nothing waits: the list stays as it is.
    let changed = false;
    void scia.nextChange(await scia.nextChange(-1)).then(() => {
      changed = true;
    });

    // At the pace of this spec — every 5 ms — forty turns would come in this time.
    await expect(
      until(
        () =>
          changed ||
          alldebrid.requests.filter((request) => request.url.includes('/magnet/')).length > asked,
        200,
      ),
    ).rejects.toThrow('never held');
  });

  it('asks for the files of every magnet ready in one turn in one request', async () => {
    const hashes = ['c', 'd', 'e'].map((letter) => letter.repeat(40));
    const alldebrid = await serviceWith({
      magnets: Object.fromEntries(
        hashes.map((hash, index) => [
          hash,
          {
            name: `Pack ${String(index)}`,
            size: readme.length,
            fetchingPolls: 0,
            files: [{ n: 'readme.txt', s: readme.length, l: 'https://alldebrid.com/f/readme' }],
          },
        ]),
      ),
    });
    const scia = await open(await connected(alldebrid));

    scia.addMagnets(hashes.map((hash) => `magnet:?xt=urn:btih:${hash}`));

    await until(
      () =>
        scia.snapshot().downloads.length === 3 &&
        scia.snapshot().downloads.every((each) => each.status === DownloadStatus.Completed),
    );
    const asked = alldebrid.requests.filter((request) => request.url === '/v4/magnet/files');
    expect(asked.map((request) => request.lists['id[]']?.length)).toEqual([3]);
  });

  it('fails a magnet whose list of files it cannot take, and asks about it no more', async () => {
    const alldebrid = await serviceWith({
      magnets: {
        [HASH]: holiday({ fetchingPolls: 0, files: [{ n: 'x', s: 1, l: 'javascript:alert(1)' }] }),
      },
    });
    const scia = await open(await connected(alldebrid));

    scia.addMagnets([MAGNET]);

    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);
    expect(scia.snapshot().magnets[0]?.failure).toBe(MagnetFailure.Unreadable);
    expect(alldebrid.requests.filter((request) => request.url === '/v4/magnet/files')).toHaveLength(
      1,
    );
  });

  it("puts a magnet's files in a folder of their own when a file stands where its folder goes", async () => {
    await mkdir(downloads(), { recursive: true });
    await writeFile(join(downloads(), 'Holiday films'), 'a file of the same name');
    const scia = await open(await connected(await serviceWith()));

    scia.addMagnets([MAGNET]);

    await until(() => allDone(scia));
    const root = join(downloads(), 'Holiday films (1)');
    expect(Buffer.compare(await readFile(join(root, 'Day 1', 'beach.mkv')), film)).toBe(0);
    expect(await readFile(join(downloads(), 'Holiday films'), 'utf8')).toBe(
      'a file of the same name',
    );
  });

  it('keeps every file of a magnet under its folder, whatever names its tree gives', async () => {
    const hostile = {
      name: '..',
      size: 3 * readme.length,
      fetchingPolls: 0,
      files: [
        {
          n: '..',
          e: [{ n: '../../evil1.txt', s: readme.length, l: 'https://alldebrid.com/f/readme' }],
        },
        {
          n: 'C:\\Windows',
          e: [{ n: 'CON', s: readme.length, l: 'https://alldebrid.com/f/readme' }],
        },
        {
          n: '.',
          e: [{ n: '/etc/evil3.txt', s: readme.length, l: 'https://alldebrid.com/f/readme' }],
        },
      ],
    };
    const scia = await open(await connected(await serviceWith({ magnets: { [HASH]: hostile } })));

    scia.addMagnets([`magnet:?xt=urn:btih:${HASH}`]);

    await until(
      () =>
        scia.snapshot().downloads.length === 3 &&
        scia.snapshot().downloads.every((each) => each.status === DownloadStatus.Completed),
    );
    // Nothing beside the engine's data and the download folder; everything under the magnet's.
    expect((await readdir(folder.path)).sort()).toEqual(['data', 'downloads']);
    expect(await readdir(downloads())).toEqual(['download']);
    for (const each of scia.snapshot().downloads) {
      expect(each.directory.startsWith(join(downloads(), 'download'))).toBe(true);
      expect(Buffer.compare(await readFile(join(each.directory, each.fileName)), readme)).toBe(0);
    }
  });

  it('says nothing of a size before the service has read the torrent', async () => {
    const alldebrid = await serviceWith({
      magnets: { [HASH]: holiday({ size: 0, nameAtUpload: 'noname', fetchingPolls: 1000 }) },
    });
    const scia = await open(await connected(alldebrid));

    scia.addMagnets([MAGNET]);

    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Fetching);
    expect(scia.snapshot().magnets[0]?.totalBytes).toBeNull();
  });

  it("keeps the service's id once it is given, and says no size, before the service says where the magnet is", async () => {
    const alldebrid = await serviceWith({ magnets: { [HASH]: holiday({ size: 0 }) } });
    alldebrid.misbehave({ silent: true, route: 'POST /v4.1/magnet/status' });
    // What the engine asks its store to keep, read where it is asked: reading state.json while
    // the store renames a new one onto it makes the rename fail on Windows.
    const saved: PersistedState[] = [];
    const store = new JsonStateStore(statePath());
    const scia = await open(await connected(alldebrid), {
      load: () => store.load(),
      save: (state) => {
        saved.push(structuredClone(state));
        return store.save(state);
      },
    });

    scia.addMagnets([MAGNET]);

    // The engine may stop at any moment while the service is asked: what it has kept says the
    // magnet was sent, and a restart waits for it instead of sending it again.
    await until(() => typeof saved.at(-1)?.magnets[0]?.serviceId === 'number', 5000);
    expect(scia.snapshot().magnets[0]).toMatchObject({
      status: MagnetStatus.Fetching,
      totalBytes: null,
    });
  });

  it('fails a magnet the service leaves out of its answer about files, as its upload would', async () => {
    const alldebrid = await serviceWith({
      magnets: { [HASH]: holiday({ leftOutOfFiles: true }) },
    });
    const scia = await open(await connected(alldebrid));

    scia.addMagnets([MAGNET]);

    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);
    expect(scia.snapshot().magnets[0]?.failure).toBe(MagnetFailure.Unavailable);
    expect(scia.snapshot().downloads).toEqual([]);
  });

  it('fails a magnet of its own whose state the service writes in a way Scia cannot read, as one it could not ask about', async () => {
    const alldebrid = await serviceWith({
      magnets: { [HASH]: holiday({ unreadableState: true }) },
    });
    const scia = await open(await connected(alldebrid));

    scia.addMagnets([MAGNET]);

    await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);
    expect(scia.snapshot().magnets[0]?.failure).toBe(MagnetFailure.Unavailable);
  });

  it('puts a file of a magnet under a free name when one of its name is already in its folder', async () => {
    const root = join(downloads(), 'Holiday films');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'readme.txt'), 'kept as it was');
    const scia = await open(await connected(await serviceWith()));

    scia.addMagnets([MAGNET]);

    await until(() => allDone(scia));
    const readmes = scia.snapshot().downloads.filter((each) => each.directory === root);
    expect(readmes).toHaveLength(1);
    expect(readmes[0]?.fileName).not.toBe('readme.txt');
    expect(Buffer.compare(await readFile(join(root, readmes[0]?.fileName ?? '')), readme)).toBe(0);
    expect(await readFile(join(root, 'readme.txt'), 'utf8')).toBe('kept as it was');
  });

  it('sends a magnet pasted while the service is asked about another as soon as that ends', async () => {
    const alldebrid = await serviceWith({
      magnets: {
        [HASH]: holiday({ fetchingPolls: 1000 }),
        ['b'.repeat(40)]: holiday({ name: 'Other', fetchingPolls: 1000 }),
      },
    });
    manager = await DownloadManager.open({
      source,
      store: new JsonStateStore(statePath()),
      defaultDirectory: downloads(),
      logger,
      // A pace far longer than the spec: what is sent within it is sent at once.
      magnetPollMs: 60_000,
      ...(await (async () => {
        const integrations = await connected(alldebrid);
        return { resolver: integrations, magnets: integrations };
      })()),
    });
    const scia = manager;
    // The first magnet's turn is slow: the second is pasted while it runs.
    alldebrid.misbehave({ slowMs: 300, times: 2 });
    scia.addMagnets([MAGNET]);
    await until(() => alldebrid.requests.length > 0);

    scia.addMagnets([OTHER]);

    await until(
      () =>
        alldebrid.requests.filter((request) => request.url === '/v4/magnet/upload').length === 2,
      3000,
    );
  });

  describe('of the account (#138)', () => {
    const CONCERT = 'c'.repeat(40);
    const uploads = (of: AllDebridServer) =>
      of.requests.filter((request) => request.url === '/v4/magnet/upload');

    it('lists every magnet of the account, also one added elsewhere, and says which Scia has', async () => {
      const alldebrid = await serviceWith({
        magnets: {
          [HASH]: holiday({ fetchingPolls: 0 }),
          [CONCERT]: holiday({ name: 'Concert', fetchingPolls: 1000 }),
        },
        onTheAccount: [HASH],
      });
      const scia = await open(await connected(alldebrid));
      scia.addMagnets([`magnet:?xt=urn:btih:${CONCERT}`]);
      await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Fetching);

      const listed = await scia.accountMagnets();

      const size = holiday().size;
      expect(listed).toEqual([
        {
          id: expect.any(Number) as unknown,
          name: 'Holiday films',
          stage: MagnetStage.Ready,
          totalBytes: size,
          downloadedBytes: size,
          bytesPerSecond: 0,
          addedAt: '2023-11-14T22:13:20.000Z',
          inScia: false,
        },
        {
          id: expect.any(Number) as unknown,
          name: 'Concert',
          stage: MagnetStage.Fetching,
          totalBytes: size,
          downloadedBytes: Math.floor(size / 2),
          bytesPerSecond: 1_048_576,
          addedAt: '2023-11-14T22:13:20.000Z',
          inScia: true,
        },
      ]);
    });

    it('downloads the files of a ready magnet of the account into its folder, and sends it nowhere', async () => {
      const alldebrid = await serviceWith({
        magnets: { [HASH]: holiday({ fetchingPolls: 0 }) },
        onTheAccount: [HASH],
      });
      const scia = await open(await connected(alldebrid));
      const [listed] = await scia.accountMagnets();

      const added = await scia.addAccountMagnet(listed?.id ?? 0);

      expect(added).toMatchObject({ name: 'Holiday films', status: MagnetStatus.Fetching });
      await until(() => allDone(scia));
      const root = join(downloads(), 'Holiday films');
      expect(Buffer.compare(await readFile(join(root, 'Day 1', 'beach.mkv')), film)).toBe(0);
      expect(scia.snapshot().magnets).toEqual([]);
      expect(uploads(alldebrid)).toEqual([]);
    });

    it('refuses a magnet the account does not have, and one the service is still fetching', async () => {
      const alldebrid = await serviceWith({
        magnets: { [HASH]: holiday({ fetchingPolls: 1000 }) },
        onTheAccount: [HASH],
      });
      const scia = await open(await connected(alldebrid));
      const [fetching] = await scia.accountMagnets();

      await expect(scia.addAccountMagnet(424_242)).rejects.toMatchObject({
        refusal: ManagerRefusal.NotFound,
      });
      await expect(scia.addAccountMagnet(fetching?.id ?? 0)).rejects.toMatchObject({
        refusal: ManagerRefusal.Conflict,
      });
      expect(scia.snapshot().magnets).toEqual([]);
    });

    it('takes a magnet of the account once, however often it is asked for at once', async () => {
      const alldebrid = await serviceWith({
        magnets: { [HASH]: holiday({ fetchingPolls: 0 }) },
        onTheAccount: [HASH],
      });
      const scia = await open(await connected(alldebrid));
      const [listed] = await scia.accountMagnets();

      const both = await Promise.allSettled([
        scia.addAccountMagnet(listed?.id ?? 0),
        scia.addAccountMagnet(listed?.id ?? 0),
      ]);

      expect(both.map((each) => each.status).sort()).toEqual(['fulfilled', 'rejected']);
      await until(() => allDone(scia));
      expect(scia.snapshot().downloads).toHaveLength(3);
    });

    it('asks again about a magnet of the account that failed, at Retry, and never sends it', async () => {
      const alldebrid = await serviceWith({
        magnets: { [HASH]: holiday({ fetchingPolls: 0, leftOutOfFiles: true }) },
        onTheAccount: [HASH],
      });
      const scia = await open(await connected(alldebrid));
      const [listed] = await scia.accountMagnets();
      const added = await scia.addAccountMagnet(listed?.id ?? 0);
      await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);

      scia.retryMagnet(added.id);

      const filesAsked = () =>
        alldebrid.requests.filter((request) => request.url === '/v4/magnet/files').length;
      await until(() => filesAsked() === 2);
      await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);
      expect(uploads(alldebrid)).toEqual([]);
    });

    // Settled once every magnet left the list: a second row of the same torrent would have made
    // its files downloads too.
    const allSettled = (scia: DownloadManager) =>
      scia.snapshot().magnets.length === 0 &&
      scia.snapshot().downloads.length >= 3 &&
      scia.snapshot().downloads.every((each) => each.status === DownloadStatus.Completed);

    it('keeps one row for a magnet taken from the account and then pasted, and downloads its files once', async () => {
      const alldebrid = await serviceWith({
        magnets: { [HASH]: holiday({ fetchingPolls: 0 }) },
        onTheAccount: [HASH],
      });
      // Slow files: both are in the list when the service gives the id back.
      alldebrid.misbehave({ slowMs: 300, times: 1, route: 'POST /v4/magnet/files' });
      const scia = await open(await connected(alldebrid));
      const [listed] = await scia.accountMagnets();

      await scia.addAccountMagnet(listed?.id ?? 0);
      scia.addMagnets([MAGNET]);

      await until(() => allSettled(scia));
      expect(scia.snapshot().downloads).toHaveLength(3);
    });

    it('keeps one row for a magnet pasted and then taken before its upload answered, and downloads its files once', async () => {
      const alldebrid = await serviceWith({
        magnets: { [HASH]: holiday({ fetchingPolls: 0 }) },
        onTheAccount: [HASH],
      });
      alldebrid.misbehave({ slowMs: 300, times: 1, route: 'POST /v4/magnet/upload' });
      const scia = await open(await connected(alldebrid));
      const [listed] = await scia.accountMagnets();

      scia.addMagnets([MAGNET]);
      await scia.addAccountMagnet(listed?.id ?? 0);

      await until(() => allSettled(scia));
      expect(scia.snapshot().downloads).toHaveLength(3);
    });

    it('lists a magnet whose date is past any calendar with no date, and still downloads a pasted one of it', async () => {
      for (const uploadDate of [300_000_000_000, 10_000_000_000_000]) {
        const alldebrid = await serviceWith({
          magnets: { [HASH]: holiday({ fetchingPolls: 0, uploadDate }) },
          onTheAccount: [HASH],
        });
        const scia = await open(await connected(alldebrid));

        expect(await scia.accountMagnets(), String(uploadDate)).toMatchObject([
          { name: 'Holiday films', addedAt: null },
        ]);
        scia.addMagnets([MAGNET]);
        await until(() => allSettled(scia));
        await scia.close();
        manager = undefined;
        await alldebrid.close();
        service = undefined;
        await rm(downloads(), { recursive: true, force: true });
        await rm(statePath(), { force: true });
      }
    });

    it('leaves out of the list a magnet the service writes in a way Scia cannot read, and takes it as unknown', async () => {
      const alldebrid = await serviceWith({
        magnets: {
          [HASH]: holiday({ fetchingPolls: 0, unreadableState: true }),
          [CONCERT]: holiday({ name: 'Concert', fetchingPolls: 0 }),
        },
        onTheAccount: [HASH, CONCERT],
      });
      const scia = await open(await connected(alldebrid));

      const listed = await scia.accountMagnets();

      expect(listed.map((each) => each.name)).toEqual(['Concert']);
      await expect(scia.addAccountMagnet((listed[0]?.id ?? 0) - 1)).rejects.toMatchObject({
        refusal: ManagerRefusal.NotFound,
      });
    });

    it('keeps a magnet taken from the account as soon as it is taken, and across a restart', async () => {
      const alldebrid = await serviceWith({
        magnets: { [HASH]: holiday({ fetchingPolls: 0 }) },
        onTheAccount: [HASH],
      });
      alldebrid.misbehave({ silent: true, route: 'POST /v4/magnet/files' });
      const saved: PersistedState[] = [];
      const store = new JsonStateStore(statePath());
      const integrations = await connected(alldebrid);
      const first = await open(integrations, {
        load: () => store.load(),
        save: (state) => {
          saved.push(structuredClone(state));
          return store.save(state);
        },
      });
      const [listed] = await first.accountMagnets();

      const taken = first.addAccountMagnet(listed?.id ?? 0);
      const before = saved.length;
      await taken;
      // Kept by the take itself, before the watch's turn says anything.
      expect(saved.slice(before)[0]?.magnets).toMatchObject([
        { serviceId: listed?.id, magnet: null },
      ]);
      await first.close();

      // It answers about files again.
      alldebrid.misbehave({ silent: true, times: 0 });
      const again = await open(integrations);

      expect(again.snapshot().magnets).toMatchObject([
        { name: 'Holiday films', status: MagnetStatus.Fetching },
      ]);
      await until(() => allSettled(again));
      expect(alldebrid.requests.filter((r) => r.url === '/v4/magnet/upload')).toEqual([]);
    });

    it('says an account that is not premium is not, when it is asked for its magnets', async () => {
      const alldebrid = await serviceWith({ onTheAccount: [HASH] });
      alldebrid.misbehave({ error: 'MAGNET_MUST_BE_PREMIUM', route: 'POST /v4.1/magnet/status' });
      const scia = await open(await connected(alldebrid));

      await expect(scia.accountMagnets()).rejects.toMatchObject({
        failure: UnlockFailure.NotPremium,
      });
      // Said once: a refusal is not asked again as a service not answering is.
      expect(alldebrid.requests.filter((r) => r.url === '/v4.1/magnet/status')).toHaveLength(1);
    });

    it.each([
      ['MAGNET_MUST_BE_PREMIUM', MagnetFailure.NotPremium],
      ['MAGNET_NO_SERVER', MagnetFailure.NetworkRefused],
    ])(
      'fails a waiting pasted magnet when the service answers %s about the account',
      async (code, failure) => {
        const alldebrid = await serviceWith({
          magnets: { [HASH]: holiday({ fetchingPolls: 1000 }) },
        });
        alldebrid.misbehave({ error: code, route: 'POST /v4.1/magnet/status' });
        const scia = await open(await connected(alldebrid));

        scia.addMagnets([MAGNET]);

        await until(() => scia.snapshot().magnets[0]?.status === MagnetStatus.Failed);
        expect(scia.snapshot().magnets[0]?.failure).toBe(failure);
      },
    );

    it('says a service is needed when none is connected', async () => {
      const alldebrid = await serviceWith({ onTheAccount: [HASH] });
      const integrations = await Integrations.open({
        vault: new MemoryVault(),
        alldebrid: new AllDebrid({ api: alldebrid.api, userAgent: 'Scia/spec' }),
        logger,
      });
      const scia = await open(integrations);

      await expect(scia.accountMagnets()).rejects.toMatchObject({
        failure: UnlockFailure.NeedsService,
      });
      await expect(scia.addAccountMagnet(1001)).rejects.toMatchObject({
        failure: UnlockFailure.NeedsService,
      });
      expect(alldebrid.requests).toEqual([]);
    });
  });

  it('logs how many magnets, never which', async () => {
    const scia = await open(await connected(await serviceWith()));

    scia.addMagnets([MAGNET]);
    await until(() => allDone(scia));

    expect(logged.join('\n')).not.toContain(HASH);
    expect(logged.join('\n')).not.toContain('Holiday');
  });

  it('logs a magnet taken from the account, never which', async () => {
    const alldebrid = await serviceWith({
      magnets: { [HASH]: holiday({ fetchingPolls: 0 }) },
      onTheAccount: [HASH],
    });
    const scia = await open(await connected(alldebrid));
    const [listed] = await scia.accountMagnets();

    await scia.addAccountMagnet(listed?.id ?? 0);

    expect(logged.filter((line) => line.includes('account_magnet_added'))).toEqual([
      JSON.stringify({ event: 'account_magnet_added' }),
    ]);
    await until(() => allDone(scia));
    expect(logged.join('\n')).not.toContain('Holiday');
  });
});
