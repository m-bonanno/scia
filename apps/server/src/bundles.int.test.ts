import { randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IntegrationId } from '@scia/contracts';
import { BundleFailure, BundleStatus, DownloadStatus } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllDebrid } from './alldebrid.ts';
import { DownloadManager, ManagerRefusal } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { Integrations } from './integrations.ts';
import { MemoryVault } from './key-vault.ts';
import type { Logger } from './logger.ts';
import type { RemoteSource } from './remote-source.ts';
import { JsonStateStore } from './state-store.ts';
import {
  type AllDebridServer,
  type AllDebridServerOptions,
  REDIRECT_LINKS,
  startAllDebridServer,
} from './testing/alldebrid-server.ts';
import { type RangeServer, startRangeServer } from './testing/range-server.ts';
import { scratchFolder, until } from './testing/scratch.ts';
import { silentSource } from './testing/silent-source.ts';

// Made up: no account anywhere has this key, and no host has these folders.
const KEY = 'spec-key-0000000000000000';
const PREMIUM_UNTIL = Date.UTC(2027, 5, 30, 12) / 1000;
const FOLDER = 'https://1fichier.com/dir/Holiday%20films';
const SHORT = 'https://bit.ly/3abcXYZ';
const ONE = `${REDIRECT_LINKS}mnsaj-0-abc`;
const TWO = `${REDIRECT_LINKS}mnsaj-1-abc`;
const THREE = `${REDIRECT_LINKS}mnsaj-2-abc`;
const LONE = `${REDIRECT_LINKS}mnsaj-9-abc`;

// A link that opens into several files (#181; docs/adr/0025), from the paste to the files chosen
// on disk: the manager, the services, AllDebrid's client and the downloader, against the simulated
// service and real local hosts.
describe('a link that opens into several files', () => {
  const source = new HttpSource('scia-test');
  const bodies = [randomBytes(40_000), randomBytes(300_000), randomBytes(9000), randomBytes(5000)];
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let hosts: RangeServer[];
  let service: AllDebridServer | undefined;
  let manager: DownloadManager | undefined;
  let logged: string[];
  let logger: Logger;

  beforeEach(async () => {
    folder = await scratchFolder();
    hosts = await Promise.all(bodies.map((body) => startRangeServer({ body })));
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

  async function serviceWith(
    options: Partial<AllDebridServerOptions> = {},
  ): Promise<AllDebridServer> {
    const [one, two, three, lone] = hosts;
    service = await startAllDebridServer({
      accounts: {
        [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL },
        'free-key-0000000000000000': { username: 'bob' },
      },
      hosts: { onefichier: ['1fichier.com'] },
      redirects: { [FOLDER]: [ONE, TWO, THREE], [SHORT]: [LONE] },
      links: {
        [ONE]: { direct: one?.url ?? '', filename: 'Day 1.mkv', size: bodies[0]?.length ?? 0 },
        [TWO]: { direct: two?.url ?? '', filename: 'Day 2.mkv', size: bodies[1]?.length ?? 0 },
        [THREE]: { direct: three?.url ?? '', filename: 'notes.nfo', size: bodies[2]?.length ?? 0 },
        [LONE]: { direct: lone?.url ?? '', filename: 'setup.exe', size: bodies[3]?.length ?? 0 },
      },
      ...options,
    });
    return service;
  }

  async function connected(to: AllDebridServer, key: string | null = KEY) {
    const vault = new MemoryVault();
    if (key !== null) await vault.write(IntegrationId.AllDebrid, key);
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
    from: RemoteSource = source,
  ): Promise<DownloadManager> {
    manager = await DownloadManager.open({
      source: from,
      store: new JsonStateStore(statePath()),
      defaultDirectory: downloads(),
      logger,
      retryDelayMs: () => 1,
      ...(integrations === undefined ? {} : { resolver: integrations, magnets: integrations }),
    });
    return manager;
  }
  const bundleOf = (scia: DownloadManager) => scia.snapshot().bundles[0];
  const choosing = (scia: DownloadManager) =>
    until(() => bundleOf(scia)?.status === BundleStatus.Choosing);
  const failed = (scia: DownloadManager) =>
    until(() => bundleOf(scia)?.status === BundleStatus.Failed);
  const asked = (server: AllDebridServer, path: string) =>
    server.requests.filter((request) => request.url === path).length;
  function allDone(scia: DownloadManager, count: number): boolean {
    const all = scia.snapshot().downloads;
    return all.length === count && all.every((each) => each.status === DownloadStatus.Completed);
  }

  it('opens a pasted folder through the service, lists its files all to choose, and downloads only those chosen, into a folder named after the link', async () => {
    const alldebrid = await serviceWith();
    const scia = await open(await connected(alldebrid));

    const added = scia.add({ urls: [FOLDER] });

    expect(added).toEqual([]);
    expect(bundleOf(scia)).toMatchObject({
      name: 'Holiday films',
      status: BundleStatus.Opening,
      failure: null,
      files: [],
    });
    await choosing(scia);
    expect(bundleOf(scia)).toMatchObject({
      files: [
        { name: 'Day 1.mkv', size: bodies[0]?.length },
        { name: 'Day 2.mkv', size: bodies[1]?.length },
        { name: 'notes.nfo', size: bodies[2]?.length },
      ],
      unavailable: 0,
    });
    // Nothing is downloaded, nor asked of a host, before the person chooses.
    expect(scia.snapshot().downloads).toEqual([]);
    expect(asked(alldebrid, '/v4/link/unlock')).toBe(0);

    const started = scia.startBundle(bundleOf(scia)?.id ?? '', [0, 2]);

    expect(started.map((download) => download.fileName)).toEqual(['Day 1.mkv', 'notes.nfo']);
    expect(scia.snapshot().bundles).toEqual([]);
    await until(() => allDone(scia, 2));
    const root = join(downloads(), 'Holiday films');
    expect(
      Buffer.compare(await readFile(join(root, 'Day 1.mkv')), bodies[0] ?? Buffer.alloc(0)),
    ).toBe(0);
    expect(
      Buffer.compare(await readFile(join(root, 'notes.nfo')), bodies[2] ?? Buffer.alloc(0)),
    ).toBe(0);
    expect(await readdir(root)).toEqual(['Day 1.mkv', 'notes.nfo']);
    expect(scia.snapshot().downloads.every((each) => each.via === IntegrationId.AllDebrid)).toBe(
      true,
    );
    expect(asked(alldebrid, '/v4/link/redirector')).toBe(1);
    expect(asked(alldebrid, '/v4/link/infos')).toBe(1);
    expect(asked(alldebrid, '/v4/link/unlock')).toBe(2);
  });

  it('downloads a link that opens into one file straight into the download folder, with no list', async () => {
    const scia = await open(await connected(await serviceWith()));

    scia.add({ urls: [SHORT] });

    await until(() => allDone(scia, 1));
    expect(scia.snapshot().bundles).toEqual([]);
    expect(
      Buffer.compare(await readFile(join(downloads(), 'setup.exe')), bodies[3] ?? Buffer.alloc(0)),
    ).toBe(0);
  });

  it('lists the files of a link with one file the service can get and others it cannot, and says how many it cannot', async () => {
    const scia = await open(
      await connected(await serviceWith({ redirects: { [FOLDER]: [ONE, 'https://x.example/'] } })),
    );

    scia.add({ urls: [FOLDER] });

    await choosing(scia);
    expect(bundleOf(scia)).toMatchObject({ files: [{ name: 'Day 1.mkv' }], unavailable: 1 });
  });

  it('opens links pasted together one after the other, and downloads the others of the paste at once', async () => {
    const alldebrid = await serviceWith();
    const scia = await open(await connected(alldebrid));
    const [, , , lone] = hosts;

    scia.add({ urls: [FOLDER, lone?.url ?? '', SHORT] });

    await until(() => bundleOf(scia)?.status === BundleStatus.Choosing && allDone(scia, 2));
    expect(
      alldebrid.requests
        .map((request) => request.url)
        .filter((url) => url.startsWith('/v4/link/') && url !== '/v4/link/unlock'),
    ).toEqual(['/v4/link/redirector', '/v4/link/infos', '/v4/link/redirector', '/v4/link/infos']);
  });

  it("names the folder after the link, and puts it beside a file of that name, never over it; a service's names lose any path", async () => {
    await mkdir(downloads(), { recursive: true });
    await writeFile(join(downloads(), 'Holiday films'), 'a file of mine');
    const scia = await open(
      await connected(
        await serviceWith({
          links: {
            [ONE]: { direct: hosts[0]?.url ?? '', filename: '..\\..\\evil.exe' },
            [TWO]: { direct: hosts[1]?.url ?? '', filename: 'Day 2.mkv' },
          },
          redirects: { [FOLDER]: [ONE, TWO] },
        }),
      ),
    );

    scia.add({ urls: [FOLDER] });
    await choosing(scia);
    scia.startBundle(bundleOf(scia)?.id ?? '', [0, 1]);

    await until(() => allDone(scia, 2));
    expect(await readFile(join(downloads(), 'Holiday films'), 'utf8')).toBe('a file of mine');
    expect((await readdir(join(downloads(), 'Holiday films (1)'))).sort()).toEqual([
      'Day 2.mkv',
      'evil.exe',
    ]);
  });

  it("says a file host's folder needs a service when none is connected, and opens it once one is, at Retry", async () => {
    const alldebrid = await serviceWith();
    const integrations = await connected(alldebrid, null);
    const scia = await open(integrations);

    scia.add({ urls: [FOLDER] });
    await failed(scia);

    expect(bundleOf(scia)?.failure).toBe(BundleFailure.NeedsService);
    expect(asked(alldebrid, '/v4/link/redirector')).toBe(0);
    await integrations.connect(IntegrationId.AllDebrid, KEY);
    scia.retryBundle(bundleOf(scia)?.id ?? '');
    await choosing(scia);
  });

  it("fetches a protector's or a shortener's link as it stands while no service is connected, as it always did", async () => {
    const probed: string[] = [];
    const scia = await open(await connected(await serviceWith(), null), {
      ...silentSource,
      probe: (url, headers, signal) => {
        probed.push(url);
        return silentSource.probe(url, headers, signal);
      },
    });

    const [added] = scia.add({ urls: [SHORT] });

    expect(added?.url).toBe(SHORT);
    expect(scia.snapshot().bundles).toEqual([]);
    await until(() => probed.length === 1);
    expect(probed).toEqual([SHORT]);
  });

  it('fetches every link as it stands with no service to ask at all', async () => {
    const scia = await open(undefined, silentSource);

    expect(scia.add({ urls: [FOLDER, SHORT] })).toHaveLength(2);
    expect(scia.snapshot().bundles).toEqual([]);
  });

  it.each([
    ['REDIRECTOR_NOT_SUPPORTED', BundleFailure.Refused],
    ['REDIRECTOR_ERROR', BundleFailure.Refused],
    ['MUST_BE_PREMIUM', BundleFailure.NotPremium],
    ['AUTH_BLOCKED', BundleFailure.KeyBlocked],
  ] as const)('says why the service did not open it: %s is %s', async (code, failure) => {
    const scia = await open(
      await connected(await serviceWith({ redirects: { [FOLDER]: { error: code } } })),
    );

    scia.add({ urls: [FOLDER] });

    await failed(scia);
    expect(bundleOf(scia)?.failure).toBe(failure);
  });

  it('says the service found nothing behind it, or too many files to list', async () => {
    const many = Array.from({ length: 1001 }, (_, index) => `${REDIRECT_LINKS}x-${String(index)}`);
    const scia = await open(
      await connected(
        await serviceWith({
          redirects: { [FOLDER]: [], [SHORT]: many },
        }),
      ),
    );

    scia.add({ urls: [FOLDER, SHORT] });

    await until(() => scia.snapshot().bundles.every((each) => each.status === BundleStatus.Failed));
    expect(scia.snapshot().bundles.map((each) => each.failure)).toEqual([
      BundleFailure.Empty,
      BundleFailure.TooMany,
    ]);
  });

  it('says the service could not be asked, and asks again at Retry', async () => {
    const alldebrid = await serviceWith();
    alldebrid.misbehave({ status: 503 });
    const scia = await open(await connected(alldebrid));

    scia.add({ urls: [FOLDER] });
    await failed(scia);

    expect(bundleOf(scia)?.failure).toBe(BundleFailure.Unavailable);
    alldebrid.misbehave(undefined);
    expect(scia.retryBundle(bundleOf(scia)?.id ?? '')).toMatchObject({
      status: BundleStatus.Opening,
      failure: null,
    });
    await choosing(scia);
  });

  it('keeps the files to choose from across a restart without asking again, and opens again one it was opening', async () => {
    const alldebrid = await serviceWith();
    let scia = await open(await connected(alldebrid));
    scia.add({ urls: [FOLDER] });
    await choosing(scia);
    alldebrid.misbehave({ silent: true });
    scia.add({ urls: [SHORT] });
    await until(() => asked(alldebrid, '/v4/link/redirector') === 2);
    await scia.close();

    alldebrid.misbehave(undefined);
    scia = await open(await connected(alldebrid));

    expect(bundleOf(scia)).toMatchObject({
      status: BundleStatus.Choosing,
      files: [{ name: 'Day 1.mkv' }, { name: 'Day 2.mkv' }, { name: 'notes.nfo' }],
    });
    await until(() => allDone(scia, 1));
    expect(asked(alldebrid, '/v4/link/redirector')).toBe(3);
    const second = scia.startBundle(bundleOf(scia)?.id ?? '', [1]);
    expect(second.map((download) => download.fileName)).toEqual(['Day 2.mkv']);
    await until(() => allDone(scia, 2));
  });

  it('forgets it at Remove, also while the service is asked, and keeps nothing of what it answers then', async () => {
    const alldebrid = await serviceWith();
    alldebrid.misbehave({ slowMs: 200 });
    const scia = await open(await connected(alldebrid));

    scia.add({ urls: [FOLDER] });
    await until(() => asked(alldebrid, '/v4/link/redirector') === 1);
    scia.removeBundle(bundleOf(scia)?.id ?? '');

    expect(scia.snapshot().bundles).toEqual([]);
    alldebrid.misbehave(undefined);
    // The next one is opened, not held behind the one removed.
    scia.add({ urls: [FOLDER] });
    await choosing(scia);
    expect(scia.snapshot().bundles).toHaveLength(1);
    expect(scia.snapshot().downloads).toEqual([]);
  });

  it('refuses to start nothing, a file it does not list, or a link that is not waiting for a choice', async () => {
    const alldebrid = await serviceWith();
    alldebrid.misbehave({ silent: true });
    const scia = await open(await connected(alldebrid));
    scia.add({ urls: [FOLDER] });
    const id = bundleOf(scia)?.id ?? '';

    expect(() => scia.startBundle(id, [0])).toThrow(
      expect.objectContaining({ refusal: ManagerRefusal.Conflict }),
    );
    expect(() => scia.retryBundle(id)).toThrow(
      expect.objectContaining({ refusal: ManagerRefusal.Conflict }),
    );
    expect(() => scia.startBundle('nobody', [0])).toThrow(
      expect.objectContaining({ refusal: ManagerRefusal.NotFound }),
    );
    await scia.close();
    alldebrid.misbehave(undefined);
    const again = await open(await connected(alldebrid));
    await choosing(again);
    for (const chosen of [[], [3], [-1], [0, 0], [0.5]]) {
      expect(() => again.startBundle(id, chosen), JSON.stringify(chosen)).toThrow(
        expect.objectContaining({ refusal: ManagerRefusal.Invalid }),
      );
    }
    expect(bundleOf(again)?.status).toBe(BundleStatus.Choosing);
  });

  it('leaves such a link out of the links taken from the clipboard: nothing is asked of a copy', async () => {
    const alldebrid = await serviceWith();
    const scia = await open(await connected(alldebrid));

    expect(await scia.offer([FOLDER, SHORT])).toEqual([]);
    expect(scia.snapshot().bundles).toEqual([]);
    expect(asked(alldebrid, '/v4/link/redirector')).toBe(0);
  });

  it("never writes the link nor the service's links in the log, nor in what it says of the link", async () => {
    const scia = await open(await connected(await serviceWith()));

    scia.add({ urls: [FOLDER] });
    await choosing(scia);
    const shown = JSON.stringify(scia.snapshot().bundles);
    scia.startBundle(bundleOf(scia)?.id ?? '', [0]);
    await until(() => allDone(scia, 1));

    for (const text of [logged.join('\n'), shown]) {
      expect(text).not.toContain('1fichier');
      expect(text).not.toContain(REDIRECT_LINKS);
    }
    expect(logged.join('\n')).toContain('bundle_opened');
  });
});
