import { IntegrationCodeStatus, IntegrationId } from '@scia/contracts';
import { CodeFailure, ServiceFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllDebrid } from './alldebrid.ts';
import { Integrations, KeyNotKeptError } from './integrations.ts';
import { type KeyVault, MemoryVault } from './key-vault.ts';
import type { Logger } from './logger.ts';
import { ServiceError } from './service-error.ts';
import { type AllDebridServer, startAllDebridServer } from './testing/alldebrid-server.ts';
import { until } from './testing/scratch.ts';

// Made up: no account anywhere has these keys.
const KEY = 'spec-key-0000000000000000';
const REVOKED = 'revoked-key-0000000000000';
const PREMIUM_UNTIL = Date.UTC(2027, 5, 30, 12) / 1000;
const ada = {
  name: 'ada',
  premium: true,
  premiumUntil: new Date(PREMIUM_UNTIL * 1000).toISOString(),
};
const notConnected = { id: 'alldebrid', connected: false, account: null, failure: null };

// A vault whose system says no to one of the things asked of it.
function refusing(action: keyof KeyVault): KeyVault {
  const vault = new MemoryVault();
  return {
    read: (name) => vault.read(name),
    write: (name, key) => vault.write(name, key),
    remove: (name) => vault.remove(name),
    [action]: () => Promise.reject(new Error('The system said no.')),
  };
}

describe('Integrations', () => {
  let service: AllDebridServer;
  let logged: string[];
  let logger: Logger;
  let clock: number;

  beforeEach(async () => {
    service = await startAllDebridServer({
      accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
    });
    logged = [];
    const log = (event: string, details?: object) => {
      logged.push(JSON.stringify({ event, ...details }));
    };
    logger = { info: log, warn: log, error: log };
    clock = 0;
  });
  afterEach(async () => {
    await service.close();
  });

  function open(
    vault: KeyVault = new MemoryVault(),
    answerLimitMs?: number,
  ): Promise<Integrations> {
    return Integrations.open({
      vault,
      alldebrid: new AllDebrid({
        api: service.api,
        userAgent: 'Scia/spec',
        ...(answerLimitMs === undefined ? {} : { answerLimitMs }),
      }),
      logger,
      now: () => clock,
      codePollMs: 5,
    });
  }

  function checksOf(check: string) {
    return service.requests.filter((request) => request.form.check === check);
  }
  // The check of the code the service gave last: the spec reads it at the service, as the engine
  // never says it.
  function lastCheck(): string {
    const asked = service.requests.filter((request) => request.form.check !== undefined);
    return asked.at(-1)?.form.check ?? '';
  }
  function statusOf(integrations: Integrations) {
    return integrations.code(IntegrationId.AllDebrid)?.status;
  }

  it('lists the services Scia knows, not connected, without asking them anything', async () => {
    const integrations = await open();

    expect(await integrations.list()).toEqual([notConnected]);
    expect(service.requests).toEqual([]);
  });

  it('connects with a key the service accepts: the vault keeps it, and the account is said', async () => {
    const vault = new MemoryVault();
    const integrations = await open(vault);

    const connected = await integrations.connect(IntegrationId.AllDebrid, KEY);

    expect(connected).toEqual({ id: 'alldebrid', connected: true, account: ada, failure: null });
    expect(await integrations.list()).toEqual([connected]);
    expect(await vault.read(IntegrationId.AllDebrid)).toBe(KEY);
  });

  it('keeps nothing of a key the service refuses', async () => {
    const vault = new MemoryVault();
    const integrations = await open(vault);

    const refused = integrations.connect(IntegrationId.AllDebrid, 'nobody-key-00000000000000');

    await expect(refused).rejects.toBeInstanceOf(ServiceError);
    await expect(refused).rejects.toMatchObject({ failure: ServiceFailure.KeyRefused });
    expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
    expect(await integrations.list()).toEqual([notConnected]);
  });

  it('keeps nothing of a key the service could not be asked about', async () => {
    const vault = new MemoryVault();
    const integrations = await open(vault);
    service.misbehave({ status: 503 });

    await expect(integrations.connect(IntegrationId.AllDebrid, KEY)).rejects.toMatchObject({
      failure: ServiceFailure.Unavailable,
    });

    expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
    expect(await integrations.list()).toEqual([notConnected]);
  });

  it('does not connect when the system will not keep the key', async () => {
    const integrations = await open(refusing('write'));

    await expect(integrations.connect(IntegrationId.AllDebrid, KEY)).rejects.toBeInstanceOf(
      KeyNotKeptError,
    );

    expect(await integrations.list()).toEqual([notConnected]);
  });

  it('is still connected after a restart, and asks the service again whose account it is', async () => {
    const vault = new MemoryVault();
    await (await open(vault)).connect(IntegrationId.AllDebrid, KEY);
    const asked = service.requests.length;

    const restarted = await open(vault);

    expect(await restarted.list()).toEqual([
      { id: 'alldebrid', connected: true, account: ada, failure: null },
    ]);
    // Once: what it then knows is believed for a minute, as after connecting.
    clock += 59_000;
    await restarted.list();
    expect(service.requests).toHaveLength(asked + 1);
  });

  it('says why, and stays connected, when the service no longer accepts the key it kept', async () => {
    const vault = new MemoryVault();
    await vault.write(IntegrationId.AllDebrid, REVOKED);

    const integrations = await open(vault);

    expect(await integrations.list()).toEqual([
      { id: 'alldebrid', connected: true, account: null, failure: ServiceFailure.KeyRefused },
    ]);
    expect(await vault.read(IntegrationId.AllDebrid)).toBe(REVOKED);
  });

  it('forgets what the service said of a key when another is connected, and when it is disconnected', async () => {
    const vault = new MemoryVault();
    await vault.write(IntegrationId.AllDebrid, REVOKED);
    const integrations = await open(vault);
    expect((await integrations.list())[0]?.failure).toBe(ServiceFailure.KeyRefused);

    expect((await integrations.connect(IntegrationId.AllDebrid, KEY)).failure).toBeNull();

    const other = new MemoryVault();
    await other.write(IntegrationId.AllDebrid, REVOKED);
    const refused = await open(other);
    await refused.list();
    await refused.disconnect(IntegrationId.AllDebrid);
    expect(await refused.list()).toEqual([notConnected]);
  });

  it('does not keep Settings waiting for a service that is slow to say whose account it is', async () => {
    const vault = new MemoryVault();
    await vault.write(IntegrationId.AllDebrid, KEY);
    service.misbehave({ silent: true });
    const integrations = await Integrations.open({
      vault,
      alldebrid: new AllDebrid({ api: service.api, userAgent: 'Scia/spec', answerLimitMs: 400 }),
      logger,
      now: () => clock,
      listWaitMs: 20,
    });

    const started = performance.now();
    const listed = await integrations.list();

    expect(performance.now() - started).toBeLessThan(300);
    expect(listed).toEqual([{ id: 'alldebrid', connected: true, account: null, failure: null }]);
    // The question is still out: its answer is there for a later listing, and not asked twice.
    // The service is let speak only once it has the question, or it would answer it in time.
    await until(() => service.requests.length === 1);
    service.misbehave(undefined);
    await until(async () => (await integrations.list())[0]?.failure !== null);
    expect(service.requests).toHaveLength(1);
    clock += 61_000;
    await until(async () => (await integrations.list())[0]?.account !== null);
    expect((await integrations.list())[0]).toEqual({
      id: 'alldebrid',
      connected: true,
      account: ada,
      failure: null,
    });
  });

  it('connects and disconnects one at a time, in the order asked', async () => {
    const other = 'other-key-000000000000000';
    await service.close();
    service = await startAllDebridServer({
      accounts: { [KEY]: { username: 'ada' }, [other]: { username: 'grace' } },
    });
    const done: string[] = [];
    const kept = new MemoryVault();
    const slow: KeyVault = {
      read: (name) => kept.read(name),
      write: async (name, key) => {
        // The first write is the slow one: were they not in turn, the second would land first.
        if (key === KEY) await new Promise((resolve) => setTimeout(resolve, 60));
        await kept.write(name, key);
        done.push(`write ${key}`);
      },
      remove: async (name) => {
        await kept.remove(name);
        done.push('remove');
      },
    };
    const integrations = await open(slow);

    await Promise.all([
      integrations.connect(IntegrationId.AllDebrid, KEY),
      integrations.connect(IntegrationId.AllDebrid, other),
      integrations.disconnect(IntegrationId.AllDebrid),
    ]);

    expect(done).toEqual([`write ${KEY}`, `write ${other}`, 'remove']);
    expect(await integrations.list()).toEqual([notConnected]);
  });

  it('puts the vault back as it was when a key was given up on and landed all the same', async () => {
    const kept = new MemoryVault();
    let late = false;
    // A vault that answers too late: the key is written, and whoever asked is told it was not.
    const tardy: KeyVault = {
      read: (name) => kept.read(name),
      write: async (name, key) => {
        await kept.write(name, key);
        if (late) throw new Error('Main did not write the key in time.');
      },
      remove: (name) => kept.remove(name),
    };
    const integrations = await open(tardy);
    late = true;

    await expect(integrations.connect(IntegrationId.AllDebrid, KEY)).rejects.toBeInstanceOf(
      KeyNotKeptError,
    );
    // Told "not kept": the next start must not find it.
    expect(await kept.read(IntegrationId.AllDebrid)).toBeUndefined();

    late = false;
    await integrations.connect(IntegrationId.AllDebrid, KEY);
    late = true;
    await service.close();
    service = await startAllDebridServer({
      accounts: { [KEY]: { username: 'ada' }, 'other-key-000000000000000': { username: 'grace' } },
    });
    const again = await Integrations.open({
      vault: tardy,
      alldebrid: new AllDebrid({ api: service.api, userAgent: 'Scia/spec' }),
      logger,
    });
    late = true;
    await expect(
      again.connect(IntegrationId.AllDebrid, 'other-key-000000000000000'),
    ).rejects.toBeInstanceOf(KeyNotKeptError);
    // Still connected with the key it had: that is the one the next start must find.
    expect(await kept.read(IntegrationId.AllDebrid)).toBe(KEY);
  });

  it("says the service is unavailable, not a link's refusal, when it answers one about the account", async () => {
    const vault = new MemoryVault();
    await vault.write(IntegrationId.AllDebrid, KEY);
    service.misbehave({ error: 'LINK_DOWN' });

    const integrations = await open(vault);

    expect((await integrations.list())[0]).toMatchObject({
      connected: true,
      failure: ServiceFailure.Unavailable,
    });
  });

  it('keeps what it knew of the account while the service does not answer, and says that it does not', async () => {
    const integrations = await open();
    await integrations.connect(IntegrationId.AllDebrid, KEY);
    service.misbehave({ status: 503 });
    clock += 10 * 60_000;

    expect(await integrations.list()).toEqual([
      { id: 'alldebrid', connected: true, account: ada, failure: ServiceFailure.Unavailable },
    ]);
  });

  it('asks the service about the account once a minute at most, however often it is listed', async () => {
    const integrations = await open();
    await integrations.connect(IntegrationId.AllDebrid, KEY);
    const asked = service.requests.length;

    await integrations.list();
    clock += 59_000;
    await Promise.all([integrations.list(), integrations.list()]);
    expect(service.requests).toHaveLength(asked);

    clock += 2000;
    await Promise.all([integrations.list(), integrations.list()]);
    expect(service.requests).toHaveLength(asked + 1);
  });

  it('says nothing of a service that was disconnected while it was being asked', async () => {
    const integrations = await open(new MemoryVault(), 100);
    await integrations.connect(IntegrationId.AllDebrid, KEY);
    service.misbehave({ silent: true });
    clock += 10 * 60_000;

    const listed = integrations.list();
    await integrations.disconnect(IntegrationId.AllDebrid);

    expect(await listed).toEqual([notConnected]);
  });

  it('starts not connected when the kept key cannot be read, and says so in the log', async () => {
    const integrations = await open(refusing('read'));

    expect(await integrations.list()).toEqual([notConnected]);
    expect(logged.join('\n')).toContain('key_not_read');
  });

  it('removes the key from the vault when it is disconnected', async () => {
    const vault = new MemoryVault();
    const integrations = await open(vault);
    await integrations.connect(IntegrationId.AllDebrid, KEY);

    await integrations.disconnect(IntegrationId.AllDebrid);

    expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
    expect(await integrations.list()).toEqual([notConnected]);
    expect(await (await open(vault)).list()).toEqual([notConnected]);
  });

  it('stays connected, and fails, when the key cannot be removed: a restart would bring it back', async () => {
    const integrations = await open(refusing('remove'));
    await integrations.connect(IntegrationId.AllDebrid, KEY);

    await expect(integrations.disconnect(IntegrationId.AllDebrid)).rejects.toThrow();

    expect((await integrations.list())[0]).toMatchObject({ connected: true });
  });

  it('replaces the key when it is connected again with another', async () => {
    const other = 'other-key-000000000000000';
    await service.close();
    service = await startAllDebridServer({
      accounts: { [KEY]: { username: 'ada' }, [other]: { username: 'grace' } },
    });
    const vault = new MemoryVault();
    const integrations = await open(vault);
    await integrations.connect(IntegrationId.AllDebrid, KEY);

    const connected = await integrations.connect(IntegrationId.AllDebrid, other);

    expect(connected.account?.name).toBe('grace');
    expect(await vault.read(IntegrationId.AllDebrid)).toBe(other);
  });

  it('keeps the key it has when another one is refused', async () => {
    const vault = new MemoryVault();
    const integrations = await open(vault);
    await integrations.connect(IntegrationId.AllDebrid, KEY);

    await expect(
      integrations.connect(IntegrationId.AllDebrid, 'nobody-key-00000000000000'),
    ).rejects.toBeInstanceOf(ServiceError);

    expect(await vault.read(IntegrationId.AllDebrid)).toBe(KEY);
    expect((await integrations.list())[0]).toMatchObject({ connected: true, account: ada });
  });

  it('never writes a key in the log, whatever happens to it', async () => {
    const kept = new MemoryVault();
    await kept.write(IntegrationId.AllDebrid, REVOKED);
    await (await open(kept)).list();
    await (await open(refusing('read'))).list();
    const unkept = await open(refusing('write'));
    await unkept.connect(IntegrationId.AllDebrid, KEY).catch(() => undefined);
    const stuck = await open(refusing('remove'));
    await stuck.connect(IntegrationId.AllDebrid, KEY);
    await stuck.disconnect(IntegrationId.AllDebrid).catch(() => undefined);
    service.misbehave({ status: 503 });
    await stuck.connect(IntegrationId.AllDebrid, KEY).catch(() => undefined);

    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toContain(KEY);
    expect(logged.join('\n')).not.toContain(REVOKED);
  });
  describe("a code confirmed on the service's site", () => {
    it('gives a code and its page, keeps nothing until it is confirmed, then connects with the key it gives', async () => {
      const vault = new MemoryVault();
      const integrations = await open(vault);

      const given = await integrations.startCode(IntegrationId.AllDebrid);

      expect(given).toEqual({
        code: expect.any(String) as unknown,
        url: `https://alldebrid.com/pin/?pin=${given.code}`,
        expiresAt: expect.any(String) as unknown,
        status: IntegrationCodeStatus.Waiting,
        failure: null,
      });
      expect(Date.parse(given.expiresAt) - Date.now()).toBeGreaterThan(590_000);
      await until(() => lastCheck() !== '');
      expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
      expect(statusOf(integrations)).toBe(IntegrationCodeStatus.Waiting);

      service.confirmCode(given.code, KEY);
      await until(() => statusOf(integrations) === IntegrationCodeStatus.Connected);

      expect(await vault.read(IntegrationId.AllDebrid)).toBe(KEY);
      expect(await integrations.list()).toEqual([
        { id: 'alldebrid', connected: true, account: ada, failure: null },
      ]);
      expect(JSON.stringify(integrations.code(IntegrationId.AllDebrid))).not.toContain(lastCheck());
      expect(logged.join('\n')).not.toContain(KEY);
      expect(logged.join('\n')).not.toContain(lastCheck());
    });

    it('says the code expired when its time ran out, and stops asking about it', async () => {
      const integrations = await open();
      await integrations.startCode(IntegrationId.AllDebrid);
      await until(() => lastCheck() !== '');
      const check = lastCheck();

      clock += 600_000;
      await until(() => statusOf(integrations) === IntegrationCodeStatus.Failed);
      const asked = checksOf(check).length;

      expect(integrations.code(IntegrationId.AllDebrid)?.failure).toBe(CodeFailure.Expired);
      await integrations.startCode(IntegrationId.AllDebrid);
      await until(() => checksOf(lastCheck()).length >= 2);
      expect(checksOf(check)).toHaveLength(asked);
    });

    it('says the code expired when the service says so', async () => {
      await service.close();
      service = await startAllDebridServer({ accounts: {}, codeLifetimeSeconds: 0 });
      const integrations = await open();

      await integrations.startCode(IntegrationId.AllDebrid);

      await until(() => statusOf(integrations) === IntegrationCodeStatus.Failed);
      expect(integrations.code(IntegrationId.AllDebrid)?.failure).toBe(CodeFailure.Expired);
    });

    it('says why a confirmed code connected nothing, and keeps nothing: a key the service refuses', async () => {
      const vault = new MemoryVault();
      const integrations = await open(vault);
      const { code } = await integrations.startCode(IntegrationId.AllDebrid);

      service.confirmCode(code, 'nobody-key-00000000000000');

      await until(() => statusOf(integrations) === IntegrationCodeStatus.Failed);
      expect(integrations.code(IntegrationId.AllDebrid)?.failure).toBe(ServiceFailure.KeyRefused);
      expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
    });

    it('says the key was not kept when the system will not keep it', async () => {
      const integrations = await open(refusing('write'));
      const { code } = await integrations.startCode(IntegrationId.AllDebrid);

      service.confirmCode(code, KEY);

      await until(() => statusOf(integrations) === IntegrationCodeStatus.Failed);
      expect(integrations.code(IntegrationId.AllDebrid)?.failure).toBe('KEY_NOT_KEPT');
      expect(await integrations.list()).toEqual([notConnected]);
    });

    it('waits on when the service cannot be asked for a while', async () => {
      const integrations = await open();
      const { code } = await integrations.startCode(IntegrationId.AllDebrid);
      service.misbehave({ status: 503, times: 4 });
      await until(
        () => service.requests.filter((request) => request.url === '/v4/pin/check').length >= 5,
      );

      service.confirmCode(code, KEY);

      await until(() => statusOf(integrations) === IntegrationCodeStatus.Connected);
    });

    it('gives no code when the service cannot be asked for one', async () => {
      const integrations = await open();
      service.misbehave({ status: 503 });

      await expect(integrations.startCode(IntegrationId.AllDebrid)).rejects.toMatchObject({
        failure: ServiceFailure.Unavailable,
      });
      expect(integrations.code(IntegrationId.AllDebrid)).toBeUndefined();
    });

    it('stops waiting when the code is cancelled: confirmed afterwards, it connects nothing', async () => {
      const integrations = await open();
      const { code } = await integrations.startCode(IntegrationId.AllDebrid);
      await until(() => lastCheck() !== '');
      const check = lastCheck();

      integrations.cancelCode(IntegrationId.AllDebrid);
      const asked = checksOf(check).length;
      service.confirmCode(code, KEY);
      expect(integrations.code(IntegrationId.AllDebrid)).toBeUndefined();
      await integrations.startCode(IntegrationId.AllDebrid);
      await until(() => checksOf(lastCheck()).length >= 2);

      expect(checksOf(check)).toHaveLength(asked);
      expect(await integrations.list()).toEqual([notConnected]);
      // A wait that was ended did not fail: nothing is said of it.
      expect(logged.join('\n')).not.toContain('service_code_failed');
    });

    it('waits only for the last of two codes asked for together', async () => {
      const integrations = await open();

      const [first, second] = await Promise.all([
        integrations.startCode(IntegrationId.AllDebrid),
        integrations.startCode(IntegrationId.AllDebrid),
      ]);
      service.confirmCode(first.code, KEY);
      expect(service.requests.filter((request) => request.url === '/v4.1/pin/get')).toHaveLength(2);
      await until(() => checksOf(lastCheck()).length >= 3);

      expect(integrations.code(IntegrationId.AllDebrid)?.code).toBe(second.code);
      expect(await integrations.list()).toEqual([notConnected]);
    });

    it('stops waiting for a code when another is asked for, or a key is pasted', async () => {
      const integrations = await open();
      const first = await integrations.startCode(IntegrationId.AllDebrid);
      await until(() => lastCheck() !== '');
      const firstCheck = lastCheck();

      const second = await integrations.startCode(IntegrationId.AllDebrid);
      expect(integrations.code(IntegrationId.AllDebrid)?.code).toBe(second.code);
      service.confirmCode(first.code, KEY);
      await until(() => lastCheck() !== firstCheck && checksOf(lastCheck()).length >= 2);
      expect(await integrations.list()).toEqual([notConnected]);

      await integrations.connect(IntegrationId.AllDebrid, KEY);
      expect(integrations.code(IntegrationId.AllDebrid)).toBeUndefined();
    });
  });
});
