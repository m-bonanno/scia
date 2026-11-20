import { IntegrationId } from '@scia/contracts';
import { ServiceFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllDebrid, ServiceError } from './alldebrid.ts';
import { Integrations, KeyNotKeptError } from './integrations.ts';
import { type KeyVault, MemoryVault } from './key-vault.ts';
import type { Logger } from './logger.ts';
import { type AllDebridServer, startAllDebridServer } from './testing/alldebrid-server.ts';

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
    });
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
});
