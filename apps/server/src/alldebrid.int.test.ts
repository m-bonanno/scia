import { integrationAccountSchema } from '@scia/contracts';
import { MagnetFailure, ServiceFailure, UnlockFailure, PREPARE_LIMIT_SECONDS } from '@scia/core';
import { afterEach, describe, expect, it } from 'vitest';
import { AllDebrid, DELAYED_LIMIT_MS, PUBLIC_ANSWER_LIMIT_MS } from './alldebrid.ts';
import { CodeExpiredError, ServiceError } from './service-error.ts';
import {
  type AllDebridServer,
  type AllDebridServerOptions,
  startAllDebridServer,
} from './testing/alldebrid-server.ts';
import { until } from './testing/scratch.ts';

// Made up: no account anywhere has these keys.
const KEY = 'spec-key-0000000000000000';
const PREMIUM_UNTIL = Date.UTC(2027, 5, 30, 12) / 1000;
const LINK = 'https://hoster.example/f/abc123';
const hosts = { hoster: ['hoster.example'] };
const accounts = {
  [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL },
  'free-key-0000000000000000': { username: 'bob' },
  'blocked-key-0000000000000': { username: 'eve', refusal: 'AUTH_BLOCKED' },
  'banned-key-00000000000000': { username: 'mal', refusal: 'AUTH_USER_BANNED' },
} as const;

describe('AllDebrid', () => {
  let service: AllDebridServer | undefined;
  const others: AllDebridServer[] = [];

  async function serviceWith(options: Partial<AllDebridServerOptions> = {}) {
    service = await startAllDebridServer({ accounts, ...options });
    return service;
  }
  function clientOf(server: AllDebridServer, answerLimitMs?: number): AllDebrid {
    return new AllDebrid({
      api: server.api,
      userAgent: 'Scia/spec',
      delayedPollMs: 1,
      retryDelayMs: () => 1,
      ...(answerLimitMs === undefined ? {} : { answerLimitMs }),
    });
  }
  async function failureOf(attempt: Promise<unknown>): Promise<ServiceError['failure']> {
    const error = await attempt.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ServiceError);
    return (error as ServiceError).failure;
  }

  afterEach(async () => {
    await service?.close();
    service = undefined;
    await Promise.all(others.splice(0).map((other) => other.close()));
  });

  it('says whose account a key is, and until when it is premium', async () => {
    const client = clientOf(await serviceWith());

    expect(await client.account(KEY)).toEqual({
      name: 'ada',
      premium: true,
      premiumUntil: new Date(PREMIUM_UNTIL * 1000).toISOString(),
    });
  });

  it('sends the key in the Authorization header, never in the address, and says it is Scia', async () => {
    const server = await serviceWith();

    await clientOf(server).account(KEY);

    expect(server.requests).toEqual([
      {
        method: 'GET',
        url: '/v4/user',
        authorization: `Bearer ${KEY}`,
        userAgent: 'Scia/spec',
        form: {},
        lists: {},
      },
    ]);
  });

  it('reads the date whether the service writes it as a number or as text', async () => {
    const client = clientOf(await serviceWith({ timestampsAsText: true }));

    expect((await client.account(KEY)).premiumUntil).toBe(
      new Date(PREMIUM_UNTIL * 1000).toISOString(),
    );
  });

  it('gives no date to an account that is not premium', async () => {
    const client = clientOf(await serviceWith());

    expect(await client.account('free-key-0000000000000000')).toEqual({
      name: 'bob',
      premium: false,
      premiumUntil: null,
    });
  });

  it('gives no date to an account that is no longer premium, though the service still names a day', async () => {
    const client = clientOf(
      await serviceWith({
        accounts: { [KEY]: { username: 'ada', premium: false, premiumUntil: PREMIUM_UNTIL } },
      }),
    );

    expect(await client.account(KEY)).toEqual({ name: 'ada', premium: false, premiumUntil: null });
  });

  it('says an account is premium without a date when the service gives none', async () => {
    const client = clientOf(
      await serviceWith({
        accounts: { [KEY]: { username: 'ada', premium: true, premiumUntil: 0 } },
      }),
    );

    expect(await client.account(KEY)).toEqual({ name: 'ada', premium: true, premiumUntil: null });
  });

  it.each([200, 401])(
    'tells an unknown key from a blocked one and from a banned account, whatever status (%i) comes with it',
    async (refusalStatus) => {
      const client = clientOf(await serviceWith({ refusalStatus }));

      expect(await failureOf(client.account('nobody-key-00000000000000'))).toBe(
        ServiceFailure.KeyRefused,
      );
      expect(await failureOf(client.account('blocked-key-0000000000000'))).toBe(
        ServiceFailure.KeyBlocked,
      );
      expect(await failureOf(client.account('banned-key-00000000000000'))).toBe(
        ServiceFailure.AccountBanned,
      );
    },
  );

  it('keeps the service’s own code beside what it means, for the log', async () => {
    const client = clientOf(await serviceWith());

    const error = await client
      .account('nobody-key-00000000000000')
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ failure: ServiceFailure.KeyRefused, code: 'AUTH_BAD_APIKEY' });
  });

  it.each([
    ['is under maintenance', { error: 'MAINTENANCE' }],
    ['answers an error Scia does not know', { error: 'SOMETHING_NEW' }],
    ['has had too many requests', { status: 429 }],
    ['is failing', { status: 503 }],
    ['answers something that is not its envelope', { nonsense: true }],
  ] as const)('says the service is unavailable when it %s', async (_case, how) => {
    const server = await serviceWith();
    server.misbehave(how);

    expect(await failureOf(clientOf(server).account(KEY))).toBe(ServiceFailure.Unavailable);
  });

  it('does not wait for a service that says nothing', async () => {
    const server = await serviceWith();
    server.misbehave({ silent: true });

    expect(await failureOf(clientOf(server, 50).account(KEY))).toBe(ServiceFailure.Unavailable);
  });

  it('says the service is unavailable when nothing listens at its address', async () => {
    const server = await serviceWith();
    await server.close();

    expect(await failureOf(clientOf(server).account(KEY))).toBe(ServiceFailure.Unavailable);
  });

  it('does not follow the service to another address, which never sees the key', async () => {
    const server = await serviceWith();
    const elsewhere = await startAllDebridServer({ accounts });
    others.push(elsewhere);
    server.misbehave({ redirectTo: `${elsewhere.api}/v4/user` });

    expect(await failureOf(clientOf(server).account(KEY))).toBe(ServiceFailure.Unavailable);

    expect(elsewhere.requests).toEqual([]);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'takes the code %s for one it does not know, though every object has a property of that name',
    async (code) => {
      const server = await serviceWith();
      server.misbehave({ error: code });

      const error = await clientOf(server)
        .account(KEY)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ failure: ServiceFailure.Unavailable, code });
    },
  );

  it.each([253_402_300_800, 8_640_000_000_000, 9e12])(
    'says the service is unavailable when the date it gives (%d) is past what the page can be told',
    async (premiumUntil) => {
      const client = clientOf(
        await serviceWith({ accounts: { [KEY]: { username: 'ada', premiumUntil } } }),
      );

      expect(await failureOf(client.account(KEY))).toBe(ServiceFailure.Unavailable);
    },
  );

  it('takes the last day the page can be told, and gives it as the contract takes it', async () => {
    const client = clientOf(
      await serviceWith({
        accounts: { [KEY]: { username: 'ada', premiumUntil: 253_402_300_799 } },
      }),
    );

    const account = await client.account(KEY);

    expect(account.premiumUntil).toBe('9999-12-31T23:59:59.000Z');
    expect(integrationAccountSchema.safeParse(account).success).toBe(true);
  });

  it('lists the domains of the hosts the account can unlock, in lower case', async () => {
    const server = await serviceWith({
      hosts: { onefile: ['OneFile.example', '1f.example'], bighost: ['bighost.example'] },
    });

    expect(await clientOf(server).domains(KEY)).toEqual([
      'onefile.example',
      '1f.example',
      'bighost.example',
    ]);
    expect(server.requests.at(-1)).toMatchObject({ method: 'GET', url: '/v4.1/user/hosts' });
  });

  it('lists the domains of the file hosts it supports to anyone, with no key, in lower case', async () => {
    const server = await serviceWith({
      hosts: { onefile: ['OneFile.example', '1f.example'], bighost: ['bighost.example'] },
      streams: ['videos.example'],
      redirectors: ['short.example'],
    });

    expect(await clientOf(server).publicDomains()).toEqual([
      'onefile.example',
      '1f.example',
      'bighost.example',
    ]);
    expect(server.requests.at(-1)).toMatchObject({ method: 'GET', url: '/v4/hosts/domains' });
    expect(server.requests.at(-1)?.authorization).toBeUndefined();
  });

  it('asks for the public list once, and gives up soon: a direct link waits on it', async () => {
    const server = await serviceWith({ hosts });
    server.misbehave({ status: 503, times: 1 });
    expect(await failureOf(clientOf(server).publicDomains())).toBe(ServiceFailure.Unavailable);
    expect(server.requests).toHaveLength(1);

    server.misbehave({ silent: true });
    const client = new AllDebrid({
      api: server.api,
      userAgent: 'Scia/spec',
      publicAnswerLimitMs: 200,
    });
    const started = performance.now();
    expect(await failureOf(client.publicDomains())).toBe(ServiceFailure.Unavailable);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(server.requests).toHaveLength(2);
  });

  it('waits three seconds at most for the public list', async () => {
    expect(PUBLIC_ANSWER_LIMIT_MS).toBe(3000);
    // Through the client as the app makes it, with no limit of its own.
    const server = await serviceWith({ hosts });
    server.misbehave({ silent: true });
    const started = performance.now();

    expect(await failureOf(clientOf(server).publicDomains())).toBe(ServiceFailure.Unavailable);
    expect(performance.now() - started).toBeLessThan(PUBLIC_ANSWER_LIMIT_MS + 1000);
  });

  it('unlocks a link: the direct link and the name the service gives, the link sent in a form', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'http://127.0.0.1:9/direct/film.mkv', filename: 'film.mkv' } },
    });

    expect(await clientOf(server).unlock(KEY, LINK)).toEqual({
      url: 'http://127.0.0.1:9/direct/film.mkv',
      fileName: 'film.mkv',
    });
    expect(server.requests).toEqual([
      {
        method: 'POST',
        url: '/v4/link/unlock',
        authorization: `Bearer ${KEY}`,
        userAgent: 'Scia/spec',
        form: { link: LINK },
        lists: { link: [LINK] },
      },
    ]);
  });

  it('waits for a link the service needs time to prepare, asking until it is there', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'http://127.0.0.1:9/direct/film.mkv', delayedPolls: 2 } },
    });

    expect((await clientOf(server).unlock(KEY, LINK)).url).toBe(
      'http://127.0.0.1:9/direct/film.mkv',
    );
    expect(server.requests.map((request) => request.url)).toEqual([
      '/v4/link/unlock',
      '/v4/link/delayed',
      '/v4/link/delayed',
      '/v4/link/delayed',
    ]);
    expect(server.requests.at(-1)?.form).toEqual({ id: '1' });
  });

  it('asks about a link being prepared no more often than it is told to', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'http://127.0.0.1:9/direct/film.mkv', delayedPolls: 2 } },
    });
    const client = new AllDebrid({ api: server.api, userAgent: 'Scia/spec', delayedPollMs: 80 });

    const started = performance.now();
    await client.unlock(KEY, LINK);

    // Three waits of 80 ms, each before a question: the wait is the case itself.
    expect(performance.now() - started).toBeGreaterThan(3 * 80 * 0.9);
  });

  it('says the link was refused when the service could not prepare it', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'http://127.0.0.1:9/x', delayedPolls: 1, fails: true } },
    });

    expect(await failureOf(clientOf(server).unlock(KEY, LINK))).toBe(UnlockFailure.LinkRefused);
  });

  it('gives up on a link the service is still preparing after the longest wait, and says so', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'http://127.0.0.1:9/x', delayedPolls: 1_000_000 } },
    });
    const client = new AllDebrid({
      api: server.api,
      userAgent: 'Scia/spec',
      delayedPollMs: 10,
      delayedLimitMs: 100,
    });

    const started = performance.now();
    expect(await failureOf(client.unlock(KEY, LINK))).toBe(UnlockFailure.NotReady);

    // About the limit, not a question more: the wait is the case itself.
    expect(performance.now() - started).toBeLessThan(1000);
    expect(server.requests.length).toBeLessThan(20);
  });

  it('waits for a link being prepared as long as the domain says, and no longer', () => {
    expect(DELAYED_LIMIT_MS).toBe(PREPARE_LIMIT_SECONDS * 1000);
  });

  it('stops waiting for a link when whoever asked stops', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'http://127.0.0.1:9/x', delayedPolls: 1_000_000 } },
    });
    const asker = new AbortController();

    const asked = clientOf(server).unlock(KEY, LINK, asker.signal);
    await until(() => server.requests.length > 3);
    asker.abort(new Error('paused'));

    await expect(asked).rejects.toThrow('paused');
  });

  it('stops with what whoever asked said, also while it waits between two questions', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'http://127.0.0.1:9/x', delayedPolls: 1_000_000 } },
    });
    const between = (options: Partial<ConstructorParameters<typeof AllDebrid>[0]>) =>
      new AllDebrid({ api: server.api, userAgent: 'Scia/spec', ...options });

    // Waiting to ask again about a link being prepared.
    const preparing = new AbortController();
    const prepared = between({ delayedPollMs: 60_000 }).unlock(KEY, LINK, preparing.signal);
    await until(() => server.requests.length === 1);
    preparing.abort(new Error('paused'));
    await expect(prepared).rejects.toThrow('paused');

    // Waiting to ask again a service that did not answer.
    server.misbehave({ status: 503, times: 1 });
    const retrying = new AbortController();
    const retried = between({ retryDelayMs: () => 60_000 }).unlock(KEY, LINK, retrying.signal);
    await until(() => server.requests.length === 2);
    retrying.abort(new Error('removed'));
    await expect(retried).rejects.toThrow('removed');

    // While its last question is on its way: no wait comes after it to say so.
    server.misbehave({ silent: true });
    const asking = new AbortController();
    const last = between({ retryDelayMs: () => 1, answerLimitMs: 1000 }).unlock(
      KEY,
      LINK,
      asking.signal,
    );
    await until(() => server.requests.length === 5);
    asking.abort(new Error('quitting'));
    await expect(last).rejects.toThrow('quitting');
  });

  it.each([
    ['MUST_BE_PREMIUM', UnlockFailure.NotPremium],
    ['FREE_TRIAL_LIMIT_REACHED', UnlockFailure.NotPremium],
    ['LINK_DOWN', UnlockFailure.LinkDown],
    ['LINK_PASS_PROTECTED', UnlockFailure.LinkPassword],
    ['LINK_HOST_UNAVAILABLE', UnlockFailure.HostUnavailable],
    ['LINK_HOST_FULL', UnlockFailure.HostUnavailable],
    ['LINK_TEMPORARY_UNAVAILABLE', UnlockFailure.HostUnavailable],
    ['LINK_HOST_LIMIT_REACHED', UnlockFailure.HostLimit],
    ['LINK_TOO_MANY_DOWNLOADS', UnlockFailure.HostLimit],
    ['LINK_IS_MISSING', UnlockFailure.LinkRefused],
    ['BAD_LINK', UnlockFailure.LinkRefused],
    ['LINK_HOST_NOT_SUPPORTED', UnlockFailure.LinkRefused],
    ['LINK_NOT_SUPPORTED', UnlockFailure.LinkRefused],
    ['LINK_ERROR', UnlockFailure.LinkRefused],
    ['DELAYED_INVALID_ID', UnlockFailure.LinkRefused],
    ['NO_SERVER', ServiceFailure.NetworkRefused],
    ['AUTH_BAD_APIKEY', ServiceFailure.KeyRefused],
    ['AUTH_BLOCKED', ServiceFailure.KeyBlocked],
    ['AUTH_USER_BANNED', ServiceFailure.AccountBanned],
  ] as const)(
    'reads the refusal %s of a link as %s, and does not ask again',
    async (code, failure) => {
      const server = await serviceWith({ hosts, links: { [LINK]: { error: code } } });

      expect(await failureOf(clientOf(server).unlock(KEY, LINK))).toBe(failure);
      expect(server.requests).toHaveLength(1);
    },
  );

  it('refuses the links the service itself refuses: not one of its hosts, not there, not for this account', async () => {
    const server = await serviceWith({ hosts, links: {} });
    const client = clientOf(server);

    expect(await failureOf(client.unlock(KEY, 'https://elsewhere.example/f/1'))).toBe(
      UnlockFailure.LinkRefused,
    );
    expect(await failureOf(client.unlock(KEY, LINK))).toBe(UnlockFailure.LinkDown);
    expect(await failureOf(client.unlock('free-key-0000000000000000', LINK))).toBe(
      UnlockFailure.NotPremium,
    );
  });

  it('refuses a link that is not an http address, whatever the service calls it', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'file:///C:/Windows/win.ini' } },
    });

    expect(await failureOf(clientOf(server).unlock(KEY, LINK))).toBe(UnlockFailure.LinkRefused);
  });

  it('asks again a service that cannot be asked at first, for a link and for its hosts', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'http://127.0.0.1:9/direct/film.mkv' } },
    });
    const client = clientOf(server);

    server.misbehave({ status: 503, times: 2 });
    expect((await client.unlock(KEY, LINK)).url).toBe('http://127.0.0.1:9/direct/film.mkv');
    server.misbehave({ status: 429, times: 2 });
    expect(await client.domains(KEY)).toEqual(['hoster.example']);

    expect(server.requests).toHaveLength(6);
  });

  it('gives up on a service that still cannot be asked the third time', async () => {
    const server = await serviceWith({ hosts, links: {} });
    server.misbehave({ status: 503 });

    expect(await failureOf(clientOf(server).unlock(KEY, LINK))).toBe(ServiceFailure.Unavailable);
    expect(server.requests).toHaveLength(3);
  });

  it('asks whose account a key is once, also when the service cannot be asked', async () => {
    const server = await serviceWith();
    server.misbehave({ status: 503 });

    await failureOf(clientOf(server).account(KEY));

    expect(server.requests).toHaveLength(1);
  });

  it("asks for a code to confirm on the service's site with no key, and says where it is confirmed", async () => {
    const server = await serviceWith();

    const code = await clientOf(server).code();

    expect(code).toEqual({
      code: expect.stringMatching(/^[A-Z0-9]{4}$/) as unknown,
      check: expect.any(String) as unknown,
      url: `https://alldebrid.com/pin/?pin=${code.code}`,
      expiresInSeconds: 600,
    });
    expect(server.requests).toEqual([
      {
        method: 'GET',
        url: '/v4.1/pin/get',
        authorization: undefined,
        userAgent: 'Scia/spec',
        form: {},
        lists: {},
      },
    ]);
  });

  it("refuses a code whose page is not on the service's site", async () => {
    const server = await serviceWith({ codePage: 'https://alldebrid.com.example/pin/' });

    expect(await failureOf(clientOf(server).code())).toBe(ServiceFailure.Unavailable);
  });

  it('waits ten minutes at most for a code, whatever the service says', async () => {
    const server = await serviceWith({ codeLifetimeSeconds: 1e13 });

    expect((await clientOf(server).code()).expiresInSeconds).toBe(600);
  });

  it('refuses a code a page could not show as it is', async () => {
    const server = await serviceWith({ codePin: 'AB CD' });

    expect(await failureOf(clientOf(server).code())).toBe(ServiceFailure.Unavailable);
  });

  it('gives no key until the person confirms the code, then the key, asking with the code and its check in a form', async () => {
    const server = await serviceWith();
    const client = clientOf(server);
    const { code, check } = await client.code();

    expect(await client.confirmedKey(code, check)).toBeUndefined();
    server.confirmCode(code, KEY);
    expect(await client.confirmedKey(code, check)).toBe(KEY);

    const asked = server.requests.filter((request) => request.url === '/v4/pin/check');
    expect(asked).toHaveLength(2);
    for (const request of asked) {
      expect(request).toEqual({
        method: 'POST',
        url: '/v4/pin/check',
        authorization: undefined,
        userAgent: 'Scia/spec',
        form: { pin: code, check },
        lists: { pin: [code], check: [check] },
      });
    }
  });

  it('says a code expired when its time ran out, and when the service no longer knows it', async () => {
    const client = clientOf(await serviceWith({ codeLifetimeSeconds: 0 }));
    const { code, check } = await client.code();

    await expect(client.confirmedKey(code, check)).rejects.toBeInstanceOf(CodeExpiredError);
    await expect(client.confirmedKey(code, 'not-its-check')).rejects.toBeInstanceOf(
      CodeExpiredError,
    );
  });

  it('refuses a key it is given for a code that is not one a header can carry', async () => {
    const server = await serviceWith();
    const client = clientOf(server);
    const { code, check } = await client.code();
    server.confirmCode(code, 'two words');

    expect(await failureOf(client.confirmedKey(code, check))).toBe(ServiceFailure.Unavailable);
  });

  describe('magnets', () => {
    const HASH = '842783e3005495d5d1637f5364b59343c7844707';
    const OTHER = '194257a7bf4eaea978f4b5b7fbd3b4efcdd99e43';
    const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=ubuntu`;
    const tree = [
      { n: 'readme.txt', s: 12, l: 'https://alldebrid.com/f/readme' },
      {
        n: 'Disc 1',
        e: [
          { n: 'a.iso', s: 100, l: 'https://alldebrid.com/f/a' },
          { n: 'Extras', e: [{ n: 'b.nfo', s: 7, l: 'https://alldebrid.com/f/b' }] },
        ],
      },
    ];
    const magnets = { [HASH]: { name: 'Ubuntu', size: 119, files: tree, fetchingPolls: 1 } };

    it('sends magnets in one form, each one answered on its own: taken with its id, or refused', async () => {
      const server = await serviceWith({
        magnets: {
          ...magnets,
          [OTHER]: { name: 'x', size: 1, files: [], error: 'MAGNET_TOO_LARGE' },
        },
      });
      const bad = `magnet:?xt=urn:btih:${OTHER}`;

      const sent = await clientOf(server).uploadMagnets(KEY, [MAGNET, bad]);

      expect(sent).toEqual([
        {
          magnet: MAGNET,
          taken: { id: expect.any(Number) as unknown, name: 'Ubuntu', size: 119, ready: false },
        },
        { magnet: bad, failure: MagnetFailure.TooLarge },
      ]);
      expect(server.requests.at(-1)).toMatchObject({
        method: 'POST',
        url: '/v4/magnet/upload',
        authorization: `Bearer ${KEY}`,
        lists: { 'magnets[]': [MAGNET, bad] },
      });
    });

    it('says what refuses every magnet of a request, as it says it of a link', async () => {
      const client = clientOf(await serviceWith({ magnets }));

      expect(await failureOf(client.uploadMagnets('free-key-0000000000000000', [MAGNET]))).toBe(
        UnlockFailure.NotPremium,
      );
      expect(await failureOf(client.uploadMagnets('nobody-key-00000000000000', [MAGNET]))).toBe(
        ServiceFailure.KeyRefused,
      );
    });

    it('says where each magnet of the account is: what the service has of it, how fast, and whether it is ready', async () => {
      const server = await serviceWith({ magnets });
      const client = clientOf(server);
      const [sent] = await client.uploadMagnets(KEY, [MAGNET]);
      const id = sent && 'taken' in sent ? sent.taken.id : 0;

      expect(await client.magnetStates(KEY)).toEqual([
        {
          id,
          name: 'Ubuntu',
          size: 119,
          downloaded: 59,
          bytesPerSecond: 1_048_576,
          stage: 'fetching',
        },
      ]);
      expect((await client.magnetStates(KEY))[0]?.stage).toBe('ready');
    });

    it("lists a ready magnet's files with the folders they are in, each with its link", async () => {
      const client = clientOf(
        await serviceWith({ magnets: { [HASH]: { ...magnets[HASH], fetchingPolls: 0 } } }),
      );
      const [sent] = await client.uploadMagnets(KEY, [MAGNET]);
      const id = sent && 'taken' in sent ? sent.taken.id : 0;

      expect(await client.magnetFiles(KEY, id)).toEqual([
        { folders: [], name: 'readme.txt', size: 12, link: 'https://alldebrid.com/f/readme' },
        { folders: ['Disc 1'], name: 'a.iso', size: 100, link: 'https://alldebrid.com/f/a' },
        {
          folders: ['Disc 1', 'Extras'],
          name: 'b.nfo',
          size: 7,
          link: 'https://alldebrid.com/f/b',
        },
      ]);
    });

    it('says a magnet failed when the service no longer has its files', async () => {
      const client = clientOf(await serviceWith({ magnets }));

      await expect(client.magnetFiles(KEY, 4242)).rejects.toMatchObject({
        name: 'MagnetError',
        failure: MagnetFailure.Failed,
      });
    });

    it('takes no file whose link is not an http address, nor a tree deeper than any torrent', async () => {
      let deep: unknown = { n: 'x.bin', s: 1, l: 'https://alldebrid.com/f/x' };
      for (let level = 0; level < 100; level += 1) deep = { n: `d${String(level)}`, e: [deep] };
      for (const files of [[{ n: 'x', s: 1, l: 'javascript:alert(1)' }], [deep]]) {
        const client = clientOf(
          await serviceWith({ magnets: { [HASH]: { name: 'x', size: 1, files: files as never } } }),
        );
        const [sent] = await client.uploadMagnets(KEY, [MAGNET]);
        const id = sent && 'taken' in sent ? sent.taken.id : 0;
        expect(await failureOf(client.magnetFiles(KEY, id))).toBe(ServiceFailure.Unavailable);
        await service?.close();
      }
    });
  });

  it('never puts the key in what it says of a failure', async () => {
    const server = await serviceWith();
    server.misbehave({ status: 503 });

    const error = await clientOf(server)
      .account(KEY)
      .catch((caught: unknown) => caught);

    expect(JSON.stringify([error, (error as Error).message, (error as Error).stack])).not.toContain(
      KEY,
    );
  });
});
