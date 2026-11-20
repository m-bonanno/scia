import { ServiceFailure, UnlockFailure } from '@scia/core';
import { afterEach, describe, expect, it } from 'vitest';
import { AllDebrid } from './alldebrid.ts';
import { ServiceError } from './service-error.ts';
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

  it('says the service is unavailable when the date it gives is none a calendar holds', async () => {
    const client = clientOf(
      await serviceWith({ accounts: { [KEY]: { username: 'ada', premiumUntil: 9e12 } } }),
    );

    expect(await failureOf(client.account(KEY))).toBe(ServiceFailure.Unavailable);
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

  it('says the link was refused when the service could not prepare it', async () => {
    const server = await serviceWith({
      hosts,
      links: { [LINK]: { direct: 'http://127.0.0.1:9/x', delayedPolls: 1, fails: true } },
    });

    expect(await failureOf(clientOf(server).unlock(KEY, LINK))).toBe(UnlockFailure.LinkRefused);
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
