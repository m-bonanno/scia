import { join } from 'node:path';
import { API_PREFIX, ApiErrorCode, DEFAULT_API_PORT, IntegrationId } from '@scia/contracts';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllDebrid } from './alldebrid.ts';
import { createApp } from './app.ts';
import { DownloadManager } from './download-manager.ts';
import { Integrations } from './integrations.ts';
import { type KeyVault, MemoryVault } from './key-vault.ts';
import { JsonStateStore } from './state-store.ts';
import { type AllDebridServer, startAllDebridServer } from './testing/alldebrid-server.ts';
import { scratchFolder, silentLogger } from './testing/scratch.ts';
import { silentSource } from './testing/silent-source.ts';

const APP_TOKEN = 'app-token-0000000000000000';
const EXTENSION_TOKEN = 'extension-token-00000000000';
const ORIGIN = `http://127.0.0.1:${String(DEFAULT_API_PORT)}`;
// Made up: no account anywhere has these keys.
const KEY = 'spec-key-0000000000000000';
const PREMIUM_UNTIL = Date.UTC(2027, 5, 30, 12) / 1000;

describe('the engine API, for the services Scia connects to', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let service: AllDebridServer;
  let manager: DownloadManager;
  let vault: MemoryVault;
  let app: Hono;

  async function appWith(keys: KeyVault): Promise<Hono> {
    return createApp({
      manager,
      integrations: await Integrations.open({
        vault: keys,
        alldebrid: new AllDebrid({ api: service.api, userAgent: 'Scia/spec' }),
        logger: silentLogger,
      }),
      apiToken: APP_TOKEN,
      extensionToken: EXTENSION_TOKEN,
      version: '1.2.3',
      port: () => DEFAULT_API_PORT,
      staticDir: undefined,
      logger: silentLogger,
    });
  }

  beforeEach(async () => {
    folder = await scratchFolder();
    service = await startAllDebridServer({
      accounts: {
        [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL },
        'blocked-key-0000000000000': { username: 'eve', refusal: 'AUTH_BLOCKED' },
        'banned-key-00000000000000': { username: 'mal', refusal: 'AUTH_USER_BANNED' },
      },
    });
    manager = await DownloadManager.open({
      source: silentSource,
      store: new JsonStateStore(join(folder.path, 'state.json')),
      defaultDirectory: join(folder.path, 'downloads'),
      logger: silentLogger,
    });
    vault = new MemoryVault();
    app = await appWith(vault);
  });
  afterEach(async () => {
    await manager.close();
    await service.close();
    await folder.remove();
  });

  function call(path: string, init: RequestInit & { token?: string; on?: Hono } = {}) {
    const { token, on, ...request } = init;
    return (on ?? app).request(`${ORIGIN}${API_PREFIX}${path}`, {
      ...request,
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
    });
  }
  // A null token is no token at all.
  const connect = (apiKey: unknown, token: string | null = APP_TOKEN, on?: Hono) =>
    call('/integrations/alldebrid', {
      method: 'PUT',
      body: JSON.stringify(apiKey === undefined ? {} : { apiKey }),
      ...(token === null ? {} : { token }),
      ...(on === undefined ? {} : { on }),
    });
  async function codeOf(response: Response): Promise<string> {
    return ((await response.json()) as { error: { code: string } }).error.code;
  }

  it('lists the services to the app alone', async () => {
    expect((await call('/integrations')).status).toBe(401);
    expect((await call('/integrations', { token: EXTENSION_TOKEN })).status).toBe(403);

    const listed = await call('/integrations', { token: APP_TOKEN });

    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      data: [{ id: 'alldebrid', connected: false, account: null, failure: null }],
    });
  });

  it('connects a service with a key it accepts, and never says the key back', async () => {
    const connected = await connect(KEY);

    expect(connected.status).toBe(200);
    const body = await connected.text();
    expect(JSON.parse(body)).toEqual({
      data: {
        id: 'alldebrid',
        connected: true,
        account: {
          name: 'ada',
          premium: true,
          premiumUntil: new Date(PREMIUM_UNTIL * 1000).toISOString(),
        },
        failure: null,
      },
    });
    expect(body).not.toContain(KEY);
    expect(await (await call('/integrations', { token: APP_TOKEN })).text()).not.toContain(KEY);
    expect(await vault.read(IntegrationId.AllDebrid)).toBe(KEY);
  });

  it('takes a key from the app alone', async () => {
    expect((await connect(KEY, null)).status).toBe(401);
    expect((await connect(KEY, EXTENSION_TOKEN)).status).toBe(403);
    expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
  });

  it('takes the key without what surrounded it when it was pasted', async () => {
    expect((await connect(`  ${KEY}\r\n`)).status).toBe(200);
    expect(await vault.read(IntegrationId.AllDebrid)).toBe(KEY);
  });

  it('refuses what cannot be a key before asking the service anything', async () => {
    for (const refused of [undefined, '', '   ', 'two words', 'line\nbreak', 'k'.repeat(257), 7]) {
      const response = await connect(refused);
      expect(response.status, JSON.stringify(refused)).toBe(400);
      expect(await codeOf(response)).toBe(ApiErrorCode.InvalidRequest);
    }
    expect(service.requests).toEqual([]);
  });

  it('says which refusal it was when the service does not take the key', async () => {
    for (const [key, code] of [
      ['nobody-key-00000000000000', ApiErrorCode.KeyRefused],
      ['blocked-key-0000000000000', ApiErrorCode.KeyBlocked],
      ['banned-key-00000000000000', ApiErrorCode.AccountBanned],
    ] as const) {
      const response = await connect(key);
      expect(response.status, key).toBe(422);
      expect(await codeOf(response)).toBe(code);
    }
    expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
  });

  it('answers 502 when the service could not be asked', async () => {
    service.misbehave({ status: 503 });

    const response = await connect(KEY);

    expect(response.status).toBe(502);
    expect(await codeOf(response)).toBe(ApiErrorCode.Unavailable);
  });

  it('answers 500, with a code of its own, when the system will not keep the key', async () => {
    const unkept: KeyVault = {
      read: () => Promise.resolve(undefined),
      write: () => Promise.reject(new Error('The system said no.')),
      remove: () => Promise.resolve(),
    };

    const response = await connect(KEY, APP_TOKEN, await appWith(unkept));

    expect(response.status).toBe(500);
    expect(await codeOf(response)).toBe(ApiErrorCode.KeyNotKept);
  });

  it('disconnects a service for the app alone, and the key is gone', async () => {
    await connect(KEY);
    const remove = (token?: string) =>
      call('/integrations/alldebrid', {
        method: 'DELETE',
        ...(token === undefined ? {} : { token }),
      });

    expect((await remove()).status).toBe(401);
    expect((await remove(EXTENSION_TOKEN)).status).toBe(403);
    expect(await vault.read(IntegrationId.AllDebrid)).toBe(KEY);

    expect((await remove(APP_TOKEN)).status).toBe(204);
    expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
    expect(await (await call('/integrations', { token: APP_TOKEN })).json()).toEqual({
      data: [{ id: 'alldebrid', connected: false, account: null, failure: null }],
    });
  });

  it('answers 404 for a service it does not know', async () => {
    const put = await call('/integrations/realdebrid', {
      method: 'PUT',
      token: APP_TOKEN,
      body: JSON.stringify({ apiKey: KEY }),
    });
    const removed = await call('/integrations/realdebrid', { method: 'DELETE', token: APP_TOKEN });

    expect(put.status).toBe(404);
    expect(await codeOf(put)).toBe(ApiErrorCode.NotFound);
    expect(removed.status).toBe(404);
  });
});
