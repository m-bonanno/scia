import { ServiceFailure } from '@scia/core';
import { afterEach, describe, expect, it } from 'vitest';
import { AllDebrid, ServiceError } from './alldebrid.ts';
import {
  type AllDebridServer,
  type AllDebridServerOptions,
  startAllDebridServer,
} from './testing/alldebrid-server.ts';

// Made up: no account anywhere has these keys.
const KEY = 'spec-key-0000000000000000';
const PREMIUM_UNTIL = Date.UTC(2027, 5, 30, 12) / 1000;
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
      ...(answerLimitMs === undefined ? {} : { answerLimitMs }),
    });
  }
  async function failureOf(attempt: Promise<unknown>): Promise<ServiceFailure> {
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
      { method: 'GET', url: '/v4/user', authorization: `Bearer ${KEY}`, userAgent: 'Scia/spec' },
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
