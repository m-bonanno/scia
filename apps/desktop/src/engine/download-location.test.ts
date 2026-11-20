import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { completedDownloadPath } from './download-location.ts';
import type { EngineAccess } from './engine-access.ts';

const download = {
  id: 'a1b2',
  url: 'https://example.com/film.mkv',
  fileName: 'film.mkv',
  directory: join('home', 'Downloads'),
  kind: 'video',
  status: 'completed',
  totalBytes: 10,
  downloadedBytes: 10,
  bytesPerSecond: 0,
  etaSeconds: null,
  resumable: true,
  segments: [],
  failure: null,
  failureStatus: null,
  via: null,
  media: null,
  timeline: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  completedAt: '2026-11-19T10:01:00.000Z',
};

function engineAnswering(body: unknown, status = 200) {
  const fetch = vi.fn<EngineAccess['fetch']>(async () => Response.json(body, { status }));
  return { origin: 'http://127.0.0.1:47821', apiToken: 'token', fetch };
}

describe('completedDownloadPath', () => {
  it('asks the engine, with main’s token, where the file is', async () => {
    const engine = engineAnswering({ data: download });

    expect(await completedDownloadPath('a1b2', engine, 1000)).toBe(
      join('home', 'Downloads', 'film.mkv'),
    );
    const [url, init] = engine.fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:47821/api/v1/downloads/a1b2');
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
  });

  it('never puts in a request what is not an id', async () => {
    const engine = engineAnswering({ data: download });

    for (const id of ['../settings', 'a/b', '', 'x'.repeat(65), 42, null, { id: 'a1b2' }]) {
      await expect(completedDownloadPath(id, engine, 1000)).rejects.toThrow('Not a download id.');
    }
    expect(engine.fetch).not.toHaveBeenCalled();
  });

  it('shows no file for a download that is not finished', async () => {
    const engine = engineAnswering({ data: { ...download, status: 'downloading' } });

    await expect(completedDownloadPath('a1b2', engine, 1000)).rejects.toThrow('finished');
  });

  it('refuses a download the engine does not know, and an answer that is not a download', async () => {
    await expect(
      completedDownloadPath('a1b2', engineAnswering({ data: download }, 404), 1000),
    ).rejects.toThrow('does not know');
    await expect(
      completedDownloadPath('a1b2', engineAnswering({ data: {} }), 1000),
    ).rejects.toThrow();
  });

  it('stops waiting for an engine that accepts the question and never answers', async () => {
    const silent: EngineAccess = {
      origin: 'http://127.0.0.1:47821',
      apiToken: 'token',
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    };

    await expect(completedDownloadPath('a1b2', silent, 20)).rejects.toThrow('aborted');
  });
});
