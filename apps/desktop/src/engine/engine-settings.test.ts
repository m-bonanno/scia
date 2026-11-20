import { describe, expect, it, vi } from 'vitest';
import type { EngineAccess } from './engine-access.ts';
import { betasOfEngine } from './engine-settings.ts';

const settings = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  downloadDirectory: 'C:\\Users\\me\\Downloads',
  speedLimitBytesPerSecond: null,
  theme: 'ice',
  betaUpdates: true,
};

function engineWith(fetch: EngineAccess['fetch']) {
  return { origin: 'http://127.0.0.1:47821', apiToken: 'token', fetch: vi.fn(fetch) };
}

describe('betasOfEngine', () => {
  it('asks the engine, with main’s token, whether the person follows the betas', async () => {
    const engine = engineWith(async () => Response.json({ data: settings }));

    expect(await betasOfEngine(engine, 1000)).toBe(true);

    const [url, init] = engine.fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:47821/api/v1/settings');
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
  });

  it('reads that alone: a setting it does not know does not fail it', async () => {
    const engine = engineWith(async () =>
      Response.json({ data: { betaUpdates: false, theme: 'neon' } }),
    );

    expect(await betasOfEngine(engine, 1000)).toBe(false);
  });

  it('rejects when the engine fails, or says something that is not a yes or a no', async () => {
    await expect(
      betasOfEngine(
        engineWith(async () => Response.json({ data: settings }, { status: 500 })),
        1000,
      ),
    ).rejects.toThrow('The engine did not say its settings.');
    await expect(
      betasOfEngine(
        engineWith(async () => Response.json({ data: { ...settings, betaUpdates: 'yes' } })),
        1000,
      ),
    ).rejects.toThrow();
  });

  it('does not wait for an engine that says nothing', async () => {
    const engine = engineWith(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );

    await expect(betasOfEngine(engine, 20)).rejects.toThrow();
  });
});
