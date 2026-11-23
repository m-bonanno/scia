import { randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IntegrationId } from '@scia/contracts';
import { BundleFailure, BundleStatus, DownloadStatus, UnlockFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllDebrid } from './alldebrid.ts';
import { DownloadManager, ManagerRefusal } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { Integrations } from './integrations.ts';
import { MemoryVault } from './key-vault.ts';
import type { LinkResolver, OpenedLink } from './link-resolver.ts';
import type { Logger } from './logger.ts';
import type { RemoteSource, RequestHeaders } from './remote-source.ts';
import { ServiceError } from './service-error.ts';
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
  // A resolver whose questions the spec answers by hand, deaf to their abort: what an answer that
  // lands after Remove or after another question does is the manager's alone.
  function byHand() {
    const asked: {
      readonly url: string;
      readonly answer: (opened: OpenedLink | typeof BundleFailure.Empty) => void;
      readonly refuse: (error: unknown) => void;
    }[] = [];
    const resolver: LinkResolver = {
      hasService: () => true,
      serviceFor: () => Promise.resolve(undefined),
      unlock: () => Promise.reject(new Error('not here')),
      open: (_service, url) =>
        new Promise((answer, refuse) => {
          asked.push({ url, answer, refuse });
        }),
    };
    return { resolver, asked };
  }
  // A host that stays silent, and says what it was asked for and with what.
  function probing() {
    const probed: { readonly url: string; readonly headers: RequestHeaders }[] = [];
    const remote: RemoteSource = {
      ...silentSource,
      probe: (url, headers, signal) => {
        probed.push({ url, headers });
        return silentSource.probe(url, headers, signal);
      },
    };
    return { remote, probed };
  }
  async function openWith(resolver: LinkResolver, from: RemoteSource = silentSource) {
    manager = await DownloadManager.open({
      source: from,
      store: new JsonStateStore(statePath()),
      defaultDirectory: downloads(),
      logger,
      retryDelayMs: () => 1,
      resolver,
    });
    return manager;
  }
  const oneFile: OpenedLink = {
    files: [{ link: ONE, name: 'Day 1.mkv', size: 10 }],
    unavailable: 0,
    leftOut: 0,
  };
  const twoFiles: OpenedLink = {
    files: [...oneFile.files, { link: TWO, name: 'Day 2.mkv', size: 20 }],
    unavailable: 0,
    leftOut: 0,
  };
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
    // Listed under the names the files will have.
    expect(bundleOf(scia)?.files.map((file) => file.name)).toEqual(['evil.exe', 'Day 2.mkv']);
    scia.startBundle(bundleOf(scia)?.id ?? '', [0, 1]);

    await until(() => allDone(scia, 2));
    expect(await readFile(join(downloads(), 'Holiday films'), 'utf8')).toBe('a file of mine');
    expect((await readdir(join(downloads(), 'Holiday films (1)'))).sort()).toEqual([
      'Day 2.mkv',
      'evil.exe',
    ]);
  });

  it("keeps the name the service gave a file over its host's, and takes its host's when the service gave none", async () => {
    const named = await Promise.all(
      ['Other.mkv', 'From host.mkv'].map(async (fileName, index) =>
        startRangeServer({ body: bodies[index] ?? Buffer.alloc(1), fileName }),
      ),
    );
    hosts.push(...named);
    const scia = await open(
      await connected(
        await serviceWith({
          links: {
            [ONE]: { direct: named[0]?.url ?? '', filename: 'Day 1.mkv' },
            [TWO]: { direct: named[1]?.url ?? '', filename: '' },
          },
          redirects: { [FOLDER]: [ONE, TWO] },
        }),
      ),
    );

    scia.add({ urls: [FOLDER] });
    await choosing(scia);
    expect(bundleOf(scia)?.files.map((file) => file.name)).toEqual(['Day 1.mkv', 'download']);
    scia.startBundle(bundleOf(scia)?.id ?? '', [0, 1]);

    await until(() => allDone(scia, 2));
    expect((await readdir(join(downloads(), 'Holiday films'))).sort()).toEqual([
      'Day 1.mkv',
      'From host.mkv',
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

  it.each([
    [
      'refuses the key',
      { redirects: { [SHORT]: { error: 'AUTH_BLOCKED' } } },
      BundleFailure.KeyBlocked,
    ],
    [
      'is not premium',
      { redirects: { [SHORT]: { error: 'MUST_BE_PREMIUM' } } },
      BundleFailure.NotPremium,
    ],
  ] as const)(
    "fails a shortener's link on its row, and fetches nothing, when the service %s",
    async (_case, options, failure) => {
      const { remote, probed } = probing();
      const scia = await open(await connected(await serviceWith(options)), remote);

      scia.add({ urls: [SHORT] });

      await failed(scia);
      expect(bundleOf(scia)?.failure).toBe(failure);
      expect(scia.snapshot().downloads).toEqual([]);
      expect(probed).toEqual([]);
    },
  );

  it("fails a shortener's link on its row, and fetches nothing, when the service cannot be asked", async () => {
    const { remote, probed } = probing();
    const alldebrid = await serviceWith();
    alldebrid.misbehave({ status: 503 });
    const scia = await open(await connected(alldebrid), remote);

    scia.add({ urls: [SHORT] });

    await failed(scia);
    expect(bundleOf(scia)?.failure).toBe(BundleFailure.Unavailable);
    expect(scia.snapshot().downloads).toEqual([]);
    expect(probed).toEqual([]);
  });

  it("adds nothing for a shortener's link whose refusal lands after Remove", async () => {
    const { resolver, asked } = byHand();
    const scia = await openWith(resolver);

    scia.add({ urls: [SHORT, FOLDER] });
    await until(() => asked.length === 1);
    scia.removeBundle(bundleOf(scia)?.id ?? '');
    asked[0]?.refuse(new ServiceError(IntegrationId.AllDebrid, UnlockFailure.LinkRefused, 'no'));
    await until(() => asked.length === 2);

    expect(scia.snapshot().downloads).toEqual([]);
    expect(scia.snapshot().bundles.map((each) => each.name)).toEqual(['Holiday films']);
  });

  it("says the service found nothing behind a file host's folder", async () => {
    const scia = await open(await connected(await serviceWith({ redirects: { [FOLDER]: [] } })));

    scia.add({ urls: [FOLDER] });

    await failed(scia);
    expect(bundleOf(scia)?.failure).toBe(BundleFailure.Empty);
  });

  it('offers the first files of a folder of more than a person ticks through, and says how many were left out', async () => {
    const many = Array.from({ length: 1002 }, (_, index) => `${REDIRECT_LINKS}x-${String(index)}`);
    const scia = await open(
      await connected(
        await serviceWith({
          redirects: { [FOLDER]: many },
          links: Object.fromEntries(many.map((link) => [link, { direct: 'http://127.0.0.1:9/x' }])),
        }),
      ),
    );

    scia.add({ urls: [FOLDER] });

    await choosing(scia);
    expect(bundleOf(scia)?.files).toHaveLength(1000);
    expect(bundleOf(scia)).toMatchObject({ unavailable: 0, leftOut: 2 });
  });

  it("fetches a shortener's link as it stands, with the page it was added from, when the service does not open it or opens it into nothing it can get", async () => {
    const { remote, probed } = probing();
    const refused = 'https://bit.ly/refused';
    const scia = await open(
      await connected(
        await serviceWith({
          redirects: { [refused]: { error: 'REDIRECTOR_NOT_SUPPORTED' }, [SHORT]: [THREE] },
          links: { [THREE]: { error: 'LINK_DOWN' } },
        }),
      ),
      remote,
    );

    scia.add({ urls: [refused, SHORT], referrer: 'https://page.example/post' });

    await until(() => probed.length === 2);
    expect(scia.snapshot().bundles).toEqual([]);
    expect(scia.snapshot().downloads.map((each) => [each.url, each.via])).toEqual([
      [refused, null],
      [SHORT, null],
    ]);
    expect(probed.map(({ url, headers }) => [url, headers.referer])).toEqual([
      [refused, 'https://page.example/post'],
      [SHORT, 'https://page.example/post'],
    ]);
    expect(logged.join('\n')).not.toContain('bit.ly');
  });

  it("fetches a shortener's link as it stands when its service left while it waited, into the folder it was added for", async () => {
    const { resolver, asked } = byHand();
    const scia = await openWith(resolver);
    const before = downloads();

    scia.add({ urls: [SHORT] });
    await until(() => asked.length === 1);
    await scia.setDownloadDirectory(join(folder.path, 'elsewhere'));
    asked[0]?.refuse(new ServiceError(IntegrationId.AllDebrid, UnlockFailure.NeedsService, 'gone'));

    await until(() => scia.snapshot().downloads.length === 1);
    expect(scia.snapshot().bundles).toEqual([]);
    expect(scia.snapshot().downloads[0]).toMatchObject({ url: SHORT, directory: before });
  });

  it("says a file host's folder needs a service when its service left while it waited", async () => {
    const { resolver, asked } = byHand();
    const scia = await openWith(resolver);

    scia.add({ urls: [FOLDER] });
    await until(() => asked.length === 1);
    asked[0]?.refuse(new ServiceError(IntegrationId.AllDebrid, UnlockFailure.NeedsService, 'gone'));

    await failed(scia);
    expect(bundleOf(scia)?.failure).toBe(BundleFailure.NeedsService);
    expect(scia.snapshot().downloads).toEqual([]);
  });

  it('says the service could not be asked when asking it failed in a way it never said', async () => {
    const { resolver, asked } = byHand();
    const scia = await openWith(resolver);

    scia.add({ urls: [FOLDER] });
    await until(() => asked.length === 1);
    asked[0]?.refuse(new Error('a socket closed'));

    await failed(scia);
    expect(bundleOf(scia)?.failure).toBe(BundleFailure.Unavailable);
  });

  it('keeps nothing of an answer that lands after Remove', async () => {
    const { resolver, asked } = byHand();
    const scia = await openWith(resolver);

    scia.add({ urls: [FOLDER, SHORT] });
    await until(() => asked.length === 1);
    scia.removeBundle(bundleOf(scia)?.id ?? '');
    asked[0]?.answer(oneFile);
    await until(() => asked.length === 2);
    asked[1]?.answer(twoFiles);

    await choosing(scia);
    expect(scia.snapshot().bundles).toHaveLength(1);
    expect(scia.snapshot().downloads).toEqual([]);
  });

  it('never asks about a link removed while it waited its turn', async () => {
    const { resolver, asked } = byHand();
    const scia = await openWith(resolver);
    const second = 'https://1fichier.com/dir/Second';

    scia.add({ urls: [FOLDER, second] });
    await until(() => asked.length === 1);
    scia.removeBundle(scia.snapshot().bundles[1]?.id ?? '');
    asked[0]?.answer(twoFiles);
    await choosing(scia);
    scia.add({ urls: [SHORT] });

    await until(() => asked.length === 2);
    expect(asked.map((each) => each.url)).toEqual([FOLDER, SHORT]);
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

  it('forgets it at Remove, also while the service is asked, and stops the question', async () => {
    const alldebrid = await serviceWith();
    alldebrid.misbehave({ silent: true });
    const scia = await open(await connected(alldebrid));

    scia.add({ urls: [FOLDER] });
    await until(() => asked(alldebrid, '/v4/link/redirector') === 1);
    scia.removeBundle(bundleOf(scia)?.id ?? '');

    expect(scia.snapshot().bundles).toEqual([]);
    alldebrid.misbehave(undefined);
    // The next one is opened, not held behind the one removed, whose question never answers: well
    // within the client's ten seconds, after which a question nobody stopped ends by itself.
    scia.add({ urls: [FOLDER] });
    await until(() => bundleOf(scia)?.status === BundleStatus.Choosing, 3000);
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
    for (const chosen of [[], [3], [-1], [0, 0], [0.5], [0, 99]]) {
      expect(() => again.startBundle(id, chosen), JSON.stringify(chosen)).toThrow(
        expect.objectContaining({ refusal: ManagerRefusal.Invalid }),
      );
    }
    expect(bundleOf(again)?.status).toBe(BundleStatus.Choosing);
    expect(again.snapshot().downloads).toEqual([]);
  });

  it("takes a file host's folder copied to the clipboard as ready, while a service is connected, and opens it into its files at Start", async () => {
    const alldebrid = await serviceWith();
    const scia = await open(await connected(alldebrid));

    const offered = await scia.offer([FOLDER, SHORT]);

    expect(offered.map((each) => [each.url, each.status])).toEqual([
      [FOLDER, DownloadStatus.Ready],
    ]);
    expect(scia.snapshot().bundles).toEqual([]);
    expect(asked(alldebrid, '/v4/link/redirector')).toBe(0);

    scia.start(offered[0]?.id ?? '');

    expect(scia.snapshot().downloads).toEqual([]);
    await choosing(scia);
    expect(bundleOf(scia)).toMatchObject({ name: 'Holiday films', files: [{}, {}, {}] });
  });

  it('opens a ready folder into its files when every ready link is started', async () => {
    const scia = await open(await connected(await serviceWith()));
    const [lone] = hosts;
    await scia.offer([FOLDER, `${lone?.url ?? ''}/setup.exe`]);

    scia.startReady();

    await choosing(scia);
    expect(scia.snapshot().downloads.map((each) => each.status)).not.toContain(
      DownloadStatus.Ready,
    );
    expect(scia.snapshot().downloads).toHaveLength(1);
  });

  it('opens a copied folder into the download folder it was copied for, whatever the setting is at its Start', async () => {
    const scia = await open(await connected(await serviceWith()));
    const [offered] = await scia.offer([FOLDER]);
    await scia.setDownloadDirectory(join(folder.path, 'elsewhere'));

    scia.start(offered?.id ?? '');
    await choosing(scia);
    const [started] = scia.startBundle(bundleOf(scia)?.id ?? '', [0]);

    expect(started?.directory).toBe(join(downloads(), 'Holiday films'));
  });

  it('does not offer again from the clipboard a folder already in the list on a row of its own', async () => {
    const alldebrid = await serviceWith();
    alldebrid.misbehave({ silent: true });
    const scia = await open(await connected(alldebrid));
    scia.add({ urls: [FOLDER] });

    expect(await scia.offer([FOLDER])).toEqual([]);
    expect(scia.snapshot().downloads).toEqual([]);
    expect(scia.snapshot().bundles).toHaveLength(1);
  });

  it('leaves a copied folder out while no service is connected: a copy is not a request to connect', async () => {
    const alldebrid = await serviceWith();
    const scia = await open(await connected(alldebrid, null));

    expect(await scia.offer([FOLDER, SHORT])).toEqual([]);
    expect(asked(alldebrid, '/v4/link/redirector')).toBe(0);
  });

  it("never writes the link in the log nor in an answer, nor the service's links in the log; its files are downloads known by the service's links", async () => {
    const scia = await open(await connected(await serviceWith()));

    scia.add({ urls: [FOLDER] });
    await choosing(scia);
    const listed = JSON.stringify(scia.snapshot());
    const started = scia.startBundle(bundleOf(scia)?.id ?? '', [0]);
    await until(() => allDone(scia, 1));

    for (const text of [logged.join('\n'), listed, JSON.stringify([started, scia.snapshot()])]) {
      expect(text).not.toContain('1fichier');
    }
    for (const text of [logged.join('\n'), listed]) {
      expect(text).not.toContain(REDIRECT_LINKS);
    }
    expect(started.map((each) => each.url)).toEqual([ONE]);
    expect(logged.join('\n')).toContain('bundle_opened');
  });
});
