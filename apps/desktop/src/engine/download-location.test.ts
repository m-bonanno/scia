import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { completedDownloadPath } from './download-location.ts';

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
  createdAt: '2026-11-19T10:00:00.000Z',
  completedAt: '2026-11-19T10:01:00.000Z',
};

function engineAnswering(body: unknown, status = 200) {
  const fetch = vi.fn(async () => Response.json(body, { status }));
  return { origin: 'http://127.0.0.1:47821', apiToken: 'token', fetch };
}

describe('completedDownloadPath', () => {
  it('asks the engine, with main’s token, where the file is', async () => {
    const engine = engineAnswering({ data: download });

    expect(await completedDownloadPath('a1b2', engine)).toBe(join('home', 'Downloads', 'film.mkv'));
    expect(engine.fetch).toHaveBeenCalledWith('http://127.0.0.1:47821/api/v1/downloads/a1b2', {
      headers: { authorization: 'Bearer token' },
    });
  });

  it('never puts in a request what is not an id', async () => {
    const engine = engineAnswering({ data: download });

    for (const id of ['../settings', 'a/b', '', 'x'.repeat(65), 42, null, { id: 'a1b2' }]) {
      await expect(completedDownloadPath(id, engine)).rejects.toThrow('Not a download id.');
    }
    expect(engine.fetch).not.toHaveBeenCalled();
  });

  it('shows no file for a download that is not finished', async () => {
    const engine = engineAnswering({ data: { ...download, status: 'downloading' } });

    await expect(completedDownloadPath('a1b2', engine)).rejects.toThrow('finished');
  });

  it('refuses a download the engine does not know, and an answer that is not a download', async () => {
    await expect(completedDownloadPath('a1b2', engineAnswering({}, 404))).rejects.toThrow();
    await expect(completedDownloadPath('a1b2', engineAnswering({ data: {} }))).rejects.toThrow();
  });
});
