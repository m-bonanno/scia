import { describe, expect, it, vi } from 'vitest';
import type { EngineAccess } from './engine-access.ts';
import { themeOfEngine } from './window-theme.ts';

const settings = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  downloadDirectory: 'C:\\Users\\me\\Downloads',
  speedLimitBytesPerSecond: null,
  theme: 'ice',
};

function engineWith(fetch: EngineAccess['fetch']) {
  return { origin: 'http://127.0.0.1:47821', apiToken: 'token', fetch: vi.fn(fetch) };
}

describe('themeOfEngine', () => {
  it('asks the engine, with main’s token, which theme the person chose', async () => {
    const engine = engineWith(async () => Response.json({ data: settings }));

    expect(await themeOfEngine(engine, 1000)).toBe('ice');

    const [url, init] = engine.fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:47821/api/v1/settings');
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
  });

  it('rejects when the engine fails, whatever it sends with the failure', async () => {
    await expect(
      themeOfEngine(
        engineWith(async () => Response.json({ data: settings }, { status: 500 })),
        1000,
      ),
    ).rejects.toThrow('The engine did not say its settings.');
  });

  it('rejects when the engine names a theme nobody knows', async () => {
    await expect(
      themeOfEngine(
        engineWith(async () => Response.json({ data: { ...settings, theme: 'neon' } })),
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

    await expect(themeOfEngine(engine, 20)).rejects.toThrow();
  });
});
