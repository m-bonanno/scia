import { describe, expect, it, vi } from 'vitest';
import { downloadActivity, unfinished } from './download-activity.ts';

function aDownload(id: string, status: string) {
  return {
    id,
    url: 'https://example.com/file.bin',
    fileName: 'file.bin',
    directory: 'downloads',
    kind: 'other',
    status,
    totalBytes: 10,
    downloadedBytes: 5,
    bytesPerSecond: 0,
    etaSeconds: null,
    resumable: true,
    segments: [],
    failure: null,
    failureStatus: null,
    createdAt: '2026-11-19T10:00:00.000Z',
    completedAt: null,
  };
}

function engineAnswering(body: unknown, status = 200) {
  const fetch = vi.fn(async () => Response.json(body, { status }));
  return { origin: 'http://127.0.0.1:47821', apiToken: 'token', fetch };
}

describe('downloadActivity', () => {
  it('counts what is running and what waits its turn, and nothing else', async () => {
    const engine = engineAnswering({
      data: [
        aDownload('a', 'downloading'),
        aDownload('b', 'downloading'),
        aDownload('c', 'queued'),
        aDownload('d', 'paused'),
        aDownload('e', 'completed'),
        aDownload('f', 'failed'),
      ],
    });

    const activity = await downloadActivity(engine);

    expect(activity).toEqual({ downloading: 2, queued: 1 });
    expect(unfinished(activity)).toBe(3);
    expect(engine.fetch).toHaveBeenCalledWith('http://127.0.0.1:47821/api/v1/downloads', {
      headers: { authorization: 'Bearer token' },
    });
  });

  it('counts nothing in an empty list', async () => {
    expect(await downloadActivity(engineAnswering({ data: [] }))).toEqual({
      downloading: 0,
      queued: 0,
    });
  });

  it('fails when the engine refuses or answers something else', async () => {
    await expect(downloadActivity(engineAnswering({}, 401))).rejects.toThrow();
    await expect(downloadActivity(engineAnswering({ data: [{ id: 'x' }] }))).rejects.toThrow();
  });
});
