import { API_PREFIX } from '@scia/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { EngineAccess } from './engine-access.ts';
import { offeredNotice, offerMagnetsToEngine, offerToEngine, sentNotice } from './offered-links.ts';

const aDownload = (id: string) => ({
  id,
  url: `https://example.com/${id}.zip`,
  fileName: `${id}.zip`,
  directory: 'D:\\Downloads',
  kind: 'archive',
  status: 'ready',
  totalBytes: null,
  downloadedBytes: 0,
  bytesPerSecond: 0,
  etaSeconds: null,
  resumable: false,
  segments: [],
  failure: null,
  failureStatus: null,
  via: null,
  media: null,
  timeline: null,
  createdAt: '2026-11-21T10:00:00.000Z',
  completedAt: null,
});

function anEngine(answer: () => Promise<Response>) {
  const fetch = vi.fn<EngineAccess['fetch']>(answer);
  const engine: EngineAccess = { origin: 'http://127.0.0.1:47883', apiToken: 'main-token', fetch };
  return { engine, fetch };
}

describe('offerToEngine', () => {
  it("hands the links to the engine with main's token, and answers how many it added", async () => {
    const { engine, fetch } = anEngine(async () =>
      Response.json({ data: [aDownload('a'), aDownload('b')] }),
    );

    const added = await offerToEngine(['https://example.com/a.zip'], engine, 5000);

    expect(added).toBe(2);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`http://127.0.0.1:47883${API_PREFIX}/downloads/offered`);
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer main-token');
    expect(JSON.parse(init.body ?? '')).toEqual({ urls: ['https://example.com/a.zip'] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects an engine that refuses, or answers something else', async () => {
    const refusing = anEngine(async () => new Response(null, { status: 400 }));
    await expect(
      offerToEngine(['https://a.example/a.zip'], refusing.engine, 5000),
    ).rejects.toThrow();

    const strange = anEngine(async () => Response.json({ data: 'no' }));
    await expect(
      offerToEngine(['https://a.example/a.zip'], strange.engine, 5000),
    ).rejects.toThrow();
  });

  it('gives up on an engine that says nothing within its limit', async () => {
    const engine: EngineAccess = {
      origin: 'http://127.0.0.1:47883',
      apiToken: 'main-token',
      // Answers only by giving up when its signal says so.
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    };

    await expect(offerToEngine(['https://a.example/a.zip'], engine, 20)).rejects.toThrow();
  });
});

describe('offerMagnetsToEngine', () => {
  it("hands the magnets to the engine with main's token, and answers how many it sent (#139)", async () => {
    const { engine, fetch } = anEngine(async () =>
      Response.json({
        data: [
          {
            id: 'm1',
            name: 'films',
            status: 'sending',
            totalBytes: null,
            downloadedBytes: 0,
            bytesPerSecond: 0,
            failure: null,
            createdAt: '2026-11-21T10:00:00.000Z',
          },
        ],
      }),
    );
    const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);

    expect(await offerMagnetsToEngine([magnet], engine, 5000)).toBe(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`http://127.0.0.1:47883${API_PREFIX}/magnets/offered`);
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer main-token');
    expect(JSON.parse(init.body ?? '')).toEqual({ magnets: [magnet] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects an engine that refuses, or answers something else', async () => {
    const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);
    const refusing = anEngine(async () => new Response(null, { status: 400 }));
    await expect(offerMagnetsToEngine([magnet], refusing.engine, 5000)).rejects.toThrow();
    const strange = anEngine(async () => Response.json({ data: 'no' }));
    await expect(offerMagnetsToEngine([magnet], strange.engine, 5000)).rejects.toThrow();
  });
});

describe('sentNotice', () => {
  it('counts the magnets added, on their way to the service, as their rows say', () => {
    expect(sentNotice(1)).toEqual({ title: 'Added 1 magnet, sending to AllDebrid', body: '' });
    expect(sentNotice(3)).toEqual({ title: 'Added 3 magnets, sending to AllDebrid', body: '' });
  });
});

describe('offeredNotice', () => {
  it('counts what was added and says it waits for a Start', () => {
    expect(offeredNotice(12)).toEqual({ title: 'Added 12 links, ready to start', body: '' });
    expect(offeredNotice(1)).toEqual({ title: 'Added 1 link, ready to start', body: '' });
  });
});
