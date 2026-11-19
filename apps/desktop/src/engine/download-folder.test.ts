import { describe, expect, it, vi } from 'vitest';
import { chooseDownloadFolder } from './download-folder.ts';
import type { EngineAccess } from './engine-access.ts';

const settings = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  downloadDirectory: 'C:\\Users\\me\\Downloads',
};

function engineWith(fetch: EngineAccess['fetch']) {
  return { origin: 'http://127.0.0.1:47821', apiToken: 'token', fetch: vi.fn(fetch) };
}

const answering = (onPut: () => Response) =>
  engineWith(async (_url, init) =>
    init.method === 'PUT' ? onPut() : Response.json({ data: settings }),
  );

describe('chooseDownloadFolder', () => {
  it('opens the dialog on the folder in use, and tells the engine the one that was chosen', async () => {
    const engine = answering(() =>
      Response.json({ data: { ...settings, downloadDirectory: 'D:\\Films' } }),
    );
    const pick = vi.fn(async () => 'D:\\Films');

    expect(await chooseDownloadFolder(pick, engine, 1000)).toBe(true);

    expect(pick).toHaveBeenCalledExactlyOnceWith('C:\\Users\\me\\Downloads');
    const [url, init] = engine.fetch.mock.calls[1]!;
    expect(url).toBe('http://127.0.0.1:47821/api/v1/settings/download-directory');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer token',
    });
    expect(init.body).toBe(JSON.stringify({ directory: 'D:\\Films' }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks the engine nothing more when the person closes the dialog', async () => {
    const engine = answering(() => Response.json({ data: settings }));

    expect(await chooseDownloadFolder(async () => undefined, engine, 1000)).toBe(false);

    expect(engine.fetch).toHaveBeenCalledTimes(1);
  });

  it('says so when the engine refuses the folder', async () => {
    const engine = answering(() =>
      Response.json({ error: { code: 'INVALID_REQUEST', message: 'no' } }, { status: 400 }),
    );

    await expect(chooseDownloadFolder(async () => 'D:\\Films', engine, 1000)).rejects.toThrow(
      'The engine refused the folder.',
    );
  });

  it('never waits on a silent engine, and shows no dialog it could not act on', async () => {
    const engine = engineWith(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const pick = vi.fn(async () => 'D:\\Films');

    await expect(chooseDownloadFolder(pick, engine, 20)).rejects.toThrow();

    expect(pick).not.toHaveBeenCalled();
  });
});
