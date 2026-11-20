import { FolderChange } from '@scia/contracts/bridge';
import { describe, expect, it, vi } from 'vitest';
import { chooseDownloadFolder, oneAtATime } from './download-folder.ts';
import type { EngineAccess } from './engine-access.ts';

const settings = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  downloadDirectory: 'C:\\Users\\me\\Downloads',
  speedLimitBytesPerSecond: null,
  theme: 'black-tie',
  betaUpdates: false,
};

function engineWith(fetch: EngineAccess['fetch']) {
  return { origin: 'http://127.0.0.1:47821', apiToken: 'token', fetch: vi.fn(fetch) };
}

const answering = (onPut: () => Response | Promise<Response>) =>
  engineWith(async (_url, init) =>
    init.method === 'PUT' ? onPut() : Response.json({ data: settings }),
  );

const silentUntilAborted = (init: { signal?: AbortSignal }) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });

describe('chooseDownloadFolder', () => {
  it('opens the dialog on the folder in use, and tells the engine the one that was chosen', async () => {
    const engine = answering(() =>
      Response.json({ data: { ...settings, downloadDirectory: 'D:\\Films' } }),
    );
    const pick = vi.fn(async () => 'D:\\Films');

    expect(await chooseDownloadFolder(pick, engine, 1000)).toBe(FolderChange.Changed);

    expect(pick).toHaveBeenCalledExactlyOnceWith('C:\\Users\\me\\Downloads');
    const [url, init] = engine.fetch.mock.calls[1]!;
    expect(url).toBe('http://127.0.0.1:47821/api/v1/settings/download-directory');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer token',
    });
    expect(init.body).toBe(JSON.stringify({ directory: 'D:\\Films' }));
  });

  it('asks the engine nothing more when the person closes the dialog', async () => {
    const engine = answering(() => Response.json({ data: settings }));

    expect(await chooseDownloadFolder(async () => undefined, engine, 1000)).toBe(FolderChange.Kept);

    expect(engine.fetch).toHaveBeenCalledTimes(1);
  });

  it('answers that the folder was refused when the engine says it cannot use it', async () => {
    const engine = answering(() =>
      Response.json({ error: { code: 'INVALID_REQUEST', message: 'no' } }, { status: 400 }),
    );

    expect(await chooseDownloadFolder(async () => 'D:\\Films', engine, 1000)).toBe(
      FolderChange.Refused,
    );
  });

  it('fails, and does not call it a refusal, when the engine fails for a reason of its own', async () => {
    const broken = answering(() =>
      Response.json({ error: { code: 'INTERNAL_ERROR', message: 'no' } }, { status: 500 }),
    );
    const unread = engineWith(async () => Response.json({ error: {} }, { status: 401 }));
    const pick = vi.fn(async () => 'D:\\Films');

    await expect(chooseDownloadFolder(pick, broken, 1000)).rejects.toThrow();
    await expect(chooseDownloadFolder(pick, unread, 1000)).rejects.toThrow();
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('never waits on a silent engine, and shows no dialog it could not act on', async () => {
    const engine = engineWith((_url, init) => silentUntilAborted(init));
    const pick = vi.fn(async () => 'D:\\Films');

    await expect(chooseDownloadFolder(pick, engine, 20)).rejects.toThrow();

    expect(pick).not.toHaveBeenCalled();
  });

  it('never waits on an engine that goes silent once the folder is chosen', async () => {
    const engine = engineWith(async (_url, init) =>
      init.method === 'PUT' ? silentUntilAborted(init) : Response.json({ data: settings }),
    );

    await expect(chooseDownloadFolder(async () => 'D:\\Films', engine, 20)).rejects.toThrow();
  });
});

describe('oneAtATime', () => {
  it('answers a second ask with the first one’s answer while that one is still open', async () => {
    let close: (value: string) => void = () => undefined;
    const ask = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          close = resolve;
        }),
    );
    const once = oneAtATime(ask);

    const first = once();
    const second = once();
    close('chosen');

    expect(await first).toBe('chosen');
    expect(await second).toBe('chosen');
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('asks again once the first has been answered, also when it failed', async () => {
    const ask = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('silent'))
      .mockResolvedValueOnce('chosen');
    const once = oneAtATime(ask);

    await expect(once()).rejects.toThrow('silent');
    expect(await once()).toBe('chosen');
  });
});
