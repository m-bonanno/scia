import { downloadSchema } from '@scia/contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { activityOf, downloadActivity, unfinished } from './download-activity.ts';
import type { EngineAccess } from './engine-access.ts';

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
    via: null,
    media: null,
    timeline: null,
    createdAt: '2026-11-19T10:00:00.000Z',
    completedAt: null,
  };
}

function engineAnswering(body: unknown, status = 200) {
  const fetch = vi.fn<EngineAccess['fetch']>(async () => Response.json(body, { status }));
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
        // Taken from the clipboard and not started: it waits for the person, not for the app.
        aDownload('g', 'ready'),
      ],
    });

    const activity = await downloadActivity(engine, 1000);

    expect(activity).toEqual({ downloading: 2, queued: 1 });
    expect(unfinished(activity)).toBe(3);
    const [url, init] = engine.fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:47821/api/v1/downloads');
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
  });

  it('counts the same from a list main already has', () => {
    const list = z
      .array(downloadSchema)
      .parse([
        aDownload('a', 'downloading'),
        aDownload('b', 'queued'),
        aDownload('c', 'failed'),
        aDownload('d', 'downloading'),
      ]);

    expect(activityOf(list)).toEqual({ downloading: 2, queued: 1 });
  });

  it('counts nothing in an empty list', async () => {
    expect(await downloadActivity(engineAnswering({ data: [] }), 1000)).toEqual({
      downloading: 0,
      queued: 0,
    });
  });

  it('fails when the engine refuses or answers something else', async () => {
    // A well-formed list with a refusal: only the status can make this one fail.
    await expect(downloadActivity(engineAnswering({ data: [] }, 401), 1000)).rejects.toThrow(
      'did not list',
    );
    await expect(
      downloadActivity(engineAnswering({ data: [{ id: 'x' }] }), 1000),
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

    await expect(downloadActivity(silent, 20)).rejects.toThrow('aborted');
  });
});
