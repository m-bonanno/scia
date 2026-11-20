import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_PREFIX, ApiErrorCode, DEFAULT_API_PORT, SETTINGS_LIMITS } from '@scia/contracts';
import { DEFAULT_THEME } from '@scia/contracts/theme';
import { DownloadFailure } from '@scia/core';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { DownloadManager } from './download-manager.ts';
import { type RemoteSource, RemoteError } from './remote-source.ts';
import { JsonStateStore } from './state-store.ts';
import { scratchFolder, silentLogger } from './testing/scratch.ts';

const APP_TOKEN = 'app-token-0000000000000000';
const EXTENSION_TOKEN = 'extension-token-00000000000';
const ORIGIN = `http://127.0.0.1:${String(DEFAULT_API_PORT)}`;

// No network in this layer: every host stays silent until the download is stopped, so a download
// that was added is still running when the next request arrives.
const silent: RemoteSource = {
  probe: (_url, _headers, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new RemoteError(DownloadFailure.Network, false, 'stopped'));
      });
    }),
  open: () => Promise.reject(new RemoteError(DownloadFailure.Network, false, 'offline')),
};

describe('the engine API', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let manager: DownloadManager;
  let app: Hono;

  beforeEach(async () => {
    folder = await scratchFolder();
    manager = await DownloadManager.open({
      source: silent,
      store: new JsonStateStore(join(folder.path, 'state.json')),
      defaultDirectory: join(folder.path, 'downloads'),
      logger: silentLogger,
    });
    app = createApp({
      manager,
      apiToken: APP_TOKEN,
      extensionToken: EXTENSION_TOKEN,
      version: '1.2.3',
      port: () => DEFAULT_API_PORT,
      staticDir: undefined,
      logger: silentLogger,
    });
  });
  afterEach(async () => {
    await manager.close();
    await folder.remove();
  });

  function call(path: string, init: RequestInit & { token?: string; origin?: string } = {}) {
    const { token, origin, ...request } = init;
    return app.request(`${origin ?? ORIGIN}${API_PREFIX}${path}`, {
      ...request,
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
    });
  }

  async function codeOf(response: Response): Promise<string> {
    return ((await response.json()) as { error: { code: string } }).error.code;
  }

  it('says it is Scia without a token, so the extension can look for it', async () => {
    const response = await call('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { name: 'scia', version: '1.2.3' } });
  });

  it('answers nothing else without a token, or with a wrong one', async () => {
    expect((await call('/downloads')).status).toBe(401);
    const wrong = await call('/downloads', { token: 'not-the-token' });
    expect(wrong.status).toBe(401);
    expect(await codeOf(wrong)).toBe(ApiErrorCode.Unauthorized);
  });

  it('refuses a request that reached it under another host name', async () => {
    const response = await call('/health', { origin: 'http://evil.example:47821' });

    expect(response.status).toBe(403);
  });

  it('adds downloads for the app and lists them', async () => {
    const added = await call('/downloads', {
      method: 'POST',
      token: APP_TOKEN,
      body: JSON.stringify({ urls: ['https://example.com/a.zip', 'https://example.com/b.zip'] }),
    });

    expect(added.status).toBe(201);
    const listed = (await (await call('/downloads', { token: APP_TOKEN })).json()) as {
      data: { fileName: string }[];
    };
    expect(listed.data.map((download) => download.fileName)).toEqual(['a.zip', 'b.zip']);
  });

  it('lets the extension add downloads and nothing else', async () => {
    const added = await call('/downloads', {
      method: 'POST',
      token: EXTENSION_TOKEN,
      body: JSON.stringify({
        urls: ['https://example.com/film.mkv'],
        referrer: 'https://example.com/page',
      }),
    });
    expect(added.status).toBe(201);
    expect((await call('/extension/check', { token: EXTENSION_TOKEN })).status).toBe(204);
    expect((await call('/extension/check', { token: 'an-old-code' })).status).toBe(401);

    for (const path of ['/downloads', '/settings', '/extension/pairing', '/events']) {
      const response = await call(path, { token: EXTENSION_TOKEN });
      expect(response.status).toBe(403);
    }
  });

  it('refuses what is not an http address', async () => {
    for (const urls of [[], ['file:///etc/passwd'], ['javascript:alert(1)'], 'https://a.test']) {
      const response = await call('/downloads', {
        method: 'POST',
        token: APP_TOKEN,
        body: JSON.stringify({ urls }),
      });
      expect(response.status).toBe(400);
    }
  });

  it('answers 404 for a download it does not have and 409 for a move it cannot make', async () => {
    expect((await call('/downloads/nope/pause', { method: 'POST', token: APP_TOKEN })).status).toBe(
      404,
    );
    const added = (await (
      await call('/downloads', {
        method: 'POST',
        token: APP_TOKEN,
        body: JSON.stringify({ urls: ['https://example.com/a.zip'] }),
      })
    ).json()) as { data: { id: string }[] };
    const id = added.data[0]!.id;

    const paused = await call(`/downloads/${id}/pause`, { method: 'POST', token: APP_TOKEN });
    expect(paused.status).toBe(200);
    const pausedTwice = await call(`/downloads/${id}/pause`, { method: 'POST', token: APP_TOKEN });
    expect(pausedTwice.status).toBe(409);
    expect(await codeOf(pausedTwice)).toBe(ApiErrorCode.Conflict);
  });

  it('gives the pairing of the extension to the app only', async () => {
    const response = await call('/extension/pairing', { token: APP_TOKEN });

    expect(await response.json()).toEqual({
      data: { token: EXTENSION_TOKEN, port: DEFAULT_API_PORT },
    });
  });

  it('takes a new download folder from the app alone, and only one it can use', async () => {
    const wanted = join(folder.path, 'elsewhere');
    const put = (token: string | undefined, body: unknown) =>
      call('/settings/download-directory', {
        method: 'PUT',
        ...(token === undefined ? {} : { token }),
        body: JSON.stringify(body),
      });

    expect((await put(undefined, { directory: wanted })).status).toBe(401);
    expect((await put(EXTENSION_TOKEN, { directory: wanted })).status).toBe(403);
    for (const refused of [{ directory: 'elsewhere' }, { directory: '' }, {}]) {
      const response = await put(APP_TOKEN, refused);
      expect(response.status, JSON.stringify(refused)).toBe(400);
      expect(await codeOf(response)).toBe('INVALID_REQUEST');
    }

    const changed = await put(APP_TOKEN, { directory: wanted });
    expect(changed.status).toBe(200);
    expect(
      ((await changed.json()) as { data: { downloadDirectory: string } }).data.downloadDirectory,
    ).toBe(wanted);
    expect(manager.settings().downloadDirectory).toBe(wanted);
  });

  it('does not let the page name a folder among the settings it changes', async () => {
    const before = manager.settings().downloadDirectory;

    await call('/settings', {
      method: 'PATCH',
      token: APP_TOKEN,
      body: JSON.stringify({ downloadDirectory: join(folder.path, 'elsewhere') }),
    });

    expect(manager.settings().downloadDirectory).toBe(before);
  });

  it('takes a speed limit above its floor, or none', async () => {
    const patch = (speedLimitBytesPerSecond: unknown) =>
      call('/settings', {
        method: 'PATCH',
        token: APP_TOKEN,
        body: JSON.stringify({ speedLimitBytesPerSecond }),
      });
    const limitOf = async (response: Response) =>
      ((await response.json()) as { data: { speedLimitBytesPerSecond: number | null } }).data
        .speedLimitBytesPerSecond;

    expect(await limitOf(await call('/settings', { token: APP_TOKEN }))).toBeNull();
    const floor = SETTINGS_LIMITS.speedLimitBytesPerSecond.min;
    for (const refused of [floor - 1, 1024 * 1024 + 0.5, -1, 'fast']) {
      expect((await patch(refused)).status, String(refused)).toBe(400);
    }
    expect(await limitOf(await patch(floor))).toBe(floor);
    expect(await limitOf(await patch(1024 * 1024))).toBe(1024 * 1024);
    expect(await limitOf(await patch(null))).toBeNull();
  });

  it('keeps the settings inside their limits', async () => {
    const tooMany = await call('/settings', {
      method: 'PATCH',
      token: APP_TOKEN,
      body: JSON.stringify({ connectionsPerDownload: 64 }),
    });
    expect(tooMany.status).toBe(400);

    const changed = await call('/settings', {
      method: 'PATCH',
      token: APP_TOKEN,
      body: JSON.stringify({ connectionsPerDownload: 4 }),
    });
    expect(
      ((await changed.json()) as { data: { connectionsPerDownload: number } }).data,
    ).toMatchObject({ connectionsPerDownload: 4 });
  });

  describe('the theme of the interface', () => {
    const themeOf = async (response: Response) =>
      ((await response.json()) as { data: { theme: string } }).data.theme;
    const choose = (theme: unknown) =>
      call('/settings', { method: 'PATCH', token: APP_TOKEN, body: JSON.stringify({ theme }) });

    it('is the default one until a person chooses another, and only one that exists', async () => {
      expect(await themeOf(await call('/settings', { token: APP_TOKEN }))).toBe(DEFAULT_THEME);

      for (const refused of ['neon', '', 3, null]) {
        expect((await choose(refused)).status, String(refused)).toBe(400);
      }
      expect(await themeOf(await choose('ice'))).toBe('ice');
      expect(await themeOf(await call('/settings', { token: APP_TOKEN }))).toBe('ice');
    });

    it('is on the page the engine serves, before any script runs', async () => {
      const staticDir = join(folder.path, 'renderer');
      await mkdir(staticDir);
      await writeFile(
        join(staticDir, 'index.html'),
        '<!doctype html>\n<html lang="en">\n  <head></head>\n</html>\n',
      );
      const serving = createApp({
        manager,
        apiToken: APP_TOKEN,
        extensionToken: EXTENSION_TOKEN,
        version: '1.2.3',
        port: () => DEFAULT_API_PORT,
        staticDir,
        logger: silentLogger,
      });
      const page = async (path: string) => (await serving.request(`${ORIGIN}${path}`)).text();

      expect(await page('/')).toContain(`<html lang="en" data-theme="${DEFAULT_THEME}">`);

      await choose('wood-floor');

      expect(await page('/')).toContain('<html lang="en" data-theme="wood-floor">');
      // Every address that is not a file is the page.
      expect(await page('/anything')).toContain('data-theme="wood-floor"');
    });
  });
});
