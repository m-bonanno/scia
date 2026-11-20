import { getEventListeners } from 'node:events';
import type { Download } from '@scia/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { EngineAccess } from './engine-access.ts';
import { followDownloads, SseFrames } from './engine-events.ts';

function aDownload(id: string, status: string) {
  return {
    id,
    url: 'https://example.com/file.bin',
    fileName: `${id}.bin`,
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
    createdAt: '2026-11-20T10:00:00.000Z',
    completedAt: null,
  };
}

const snapshot = (...downloads: unknown[]) =>
  `event: snapshot\ndata: ${JSON.stringify({ downloads })}\n\n`;

// An answer of the engine whose body the spec writes piece by piece, and ends when it likes.
function aStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (given) => {
      controller = given;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    say: (text: string) => {
      controller.enqueue(encoder.encode(text));
    },
    end: () => {
      controller.close();
    },
  };
}

type Answer = (init: Parameters<EngineAccess['fetch']>[1]) => Promise<Response>;

function following(
  answers: Answer[],
  origins = ['http://127.0.0.1:47821'],
  silenceLimitMs = 60_000,
) {
  const stopped = new AbortController();
  const seen: string[][] = [];
  const warnings: string[] = [];
  const said: string[] = [];
  const waits: number[] = [];
  let attempt = 0;
  const fetch = vi.fn<EngineAccess['fetch']>(async (_url, init) => {
    const answer = answers[Math.min(attempt, answers.length - 1)]!;
    attempt += 1;
    init.signal?.throwIfAborted();
    return answer(init);
  });
  let asked = 0;
  const done = followDownloads({
    engine: () => {
      const origin = origins[Math.min(asked, origins.length - 1)]!;
      asked += 1;
      return { origin, apiToken: 'token', fetch };
    },
    onDownloads: (downloads: readonly Download[]) => {
      seen.push(downloads.map((download) => `${download.id}:${download.status}`));
    },
    signal: stopped.signal,
    answerLimitMs: 50,
    silenceLimitMs,
    retryMs: 700,
    sleep: async (ms) => {
      waits.push(ms);
    },
    log: {
      warn: (message) => warnings.push(message),
      info: (message) => said.push(message),
    },
  });
  return { stopped, seen, warnings, said, waits, fetch, done };
}

describe('SseFrames', () => {
  it('reads an event however its text was cut into pieces', () => {
    const frames = new SseFrames();

    expect(frames.push('event: snap')).toEqual([]);
    expect(frames.push('shot\ndata: {"a"')).toEqual([]);
    expect(frames.push(':1}\n\nevent: snapshot\ndata: {}\n\n')).toEqual([
      { event: 'snapshot', data: '{"a":1}' },
      { event: 'snapshot', data: '{}' },
    ]);
  });

  it('joins the lines of one event, and passes over comments and the lines it does not use', () => {
    const frames = new SseFrames();

    expect(
      frames.push(': keep-alive\n\nid: 7\nevent: note\r\ndata: one\r\ndata: two\r\n\r\n'),
    ).toEqual([{ event: 'note', data: 'one\ntwo' }]);
  });
});

describe('followDownloads', () => {
  it('asks the engine for its events with main’s token, and hands over each list as it comes', async () => {
    const stream = aStream();
    const follow = following([async () => stream.response]);

    stream.say(snapshot(aDownload('a', 'downloading')));
    stream.say(snapshot(aDownload('a', 'completed'), aDownload('b', 'queued')));
    await vi.waitFor(() => {
      expect(follow.seen).toEqual([['a:downloading'], ['a:completed', 'b:queued']]);
    });

    const [url, init] = follow.fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:47821/api/v1/events');
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
    follow.stopped.abort();
    await follow.done;
  });

  it('opens the stream again when it ends, where the engine is by then', async () => {
    const first = aStream();
    const second = aStream();
    const follow = following(
      [async () => first.response, async () => second.response],
      ['http://127.0.0.1:47821', 'http://127.0.0.1:50000'],
    );
    first.say(snapshot(aDownload('a', 'downloading')));
    await vi.waitFor(() => {
      expect(follow.seen).toHaveLength(1);
    });

    // The engine stopped and was started again, on another port.
    first.end();
    second.say(snapshot(aDownload('a', 'completed')));
    await vi.waitFor(() => {
      expect(follow.seen).toEqual([['a:downloading'], ['a:completed']]);
    });

    expect(follow.waits).toEqual([700]);
    expect(follow.fetch.mock.calls[1]![0]).toBe('http://127.0.0.1:50000/api/v1/events');
    // One attempt listens for the stop at a time: the one that ended took its listener away.
    expect(getEventListeners(follow.stopped.signal, 'abort')).toHaveLength(1);
    follow.stopped.abort();
    await follow.done;
    expect(getEventListeners(follow.stopped.signal, 'abort')).toHaveLength(0);
  });

  it('tries again after a refusal, and after an engine that does not answer in time', async () => {
    const stream = aStream();
    const follow = following([
      async () => new Response(null, { status: 503 }),
      // Alive and silent: the answer never comes, until whoever asked gives up.
      (init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('given up'));
          });
        }),
      async () => stream.response,
    ]);

    stream.say(snapshot(aDownload('a', 'queued')));
    await vi.waitFor(() => {
      expect(follow.seen).toEqual([['a:queued']]);
    });

    expect(follow.fetch).toHaveBeenCalledTimes(3);
    expect(follow.waits).toEqual([700, 700]);
    // Said once when the events are lost and once when they are back, not at every attempt.
    expect(follow.warnings).toEqual(['engine_events_lost']);
    expect(follow.said).toEqual(['engine_events_back']);
    follow.stopped.abort();
    await follow.done;
  });

  it('passes over an event it does not know and a list that is not one, and goes on', async () => {
    const stream = aStream();
    const follow = following([async () => stream.response]);

    stream.say('event: hello\ndata: {}\n\n');
    stream.say('event: snapshot\ndata: {"downloads":[{"id":7}]}\n\n');
    stream.say('event: snapshot\ndata: not json\n\n');
    stream.say(snapshot(aDownload('a', 'failed')));
    await vi.waitFor(() => {
      expect(follow.seen).toEqual([['a:failed']]);
    });

    expect(follow.warnings).toEqual(['engine_event_unreadable', 'engine_event_unreadable']);
    expect(follow.said).toEqual([]);
    follow.stopped.abort();
    await follow.done;
  });

  it('says each loss once and each return once, the second time as the first', async () => {
    const first = aStream();
    const second = aStream();
    const refused = async () => new Response(null, { status: 503 });
    const follow = following([
      refused,
      refused,
      async () => first.response,
      refused,
      refused,
      async () => second.response,
    ]);

    first.say(snapshot(aDownload('a', 'downloading')));
    await vi.waitFor(() => {
      expect(follow.seen).toHaveLength(1);
    });
    first.end();
    second.say(snapshot(aDownload('a', 'completed')));
    await vi.waitFor(() => {
      expect(follow.seen).toHaveLength(2);
    });

    expect(follow.warnings).toEqual(['engine_events_lost', 'engine_events_lost']);
    expect(follow.said).toEqual(['engine_events_back', 'engine_events_back']);
    follow.stopped.abort();
    await follow.done;
  });

  it('does not say the events are back for an answer that begins and says nothing', async () => {
    const mute = aStream();
    const next = aStream();
    const follow = following(
      [async () => mute.response, async () => next.response],
      undefined,
      120,
    );

    await vi.waitFor(() => {
      expect(follow.fetch).toHaveBeenCalledTimes(2);
    });
    // Lost, and not back: nothing was heard on the stream that was opened.
    expect(follow.warnings).toEqual(['engine_events_lost']);
    expect(follow.said).toEqual([]);

    next.say(snapshot(aDownload('a', 'queued')));
    await vi.waitFor(() => {
      expect(follow.said).toEqual(['engine_events_back']);
    });
    follow.stopped.abort();
    await follow.done;
  });

  it('closes the body of an answer it refuses', async () => {
    let closed = false;
    const refusal = new Response(
      new ReadableStream<Uint8Array>({
        cancel: () => {
          closed = true;
        },
      }),
      { status: 503 },
    );
    const stream = aStream();
    const follow = following([async () => refusal, async () => stream.response]);

    stream.say(snapshot(aDownload('a', 'queued')));
    await vi.waitFor(() => {
      expect(follow.seen).toHaveLength(1);
    });

    expect(closed).toBe(true);
    follow.stopped.abort();
    await follow.done;
  });

  it('stops when it is told to, also while the engine is silent, and asks nothing more', async () => {
    const stream = aStream();
    const follow = following([async () => stream.response]);
    stream.say(snapshot());
    await vi.waitFor(() => {
      expect(follow.seen).toHaveLength(1);
    });

    follow.stopped.abort();
    await follow.done;

    expect(follow.fetch).toHaveBeenCalledOnce();
    expect(follow.waits).toEqual([]);
  });

  it('gives up a stream on which nothing is heard for too long, and opens it again', async () => {
    const quiet = aStream();
    const next = aStream();
    const follow = following(
      [async () => quiet.response, async () => next.response],
      undefined,
      120,
    );
    quiet.say(snapshot(aDownload('a', 'downloading')));

    // Not a word after the first list: an engine that is alive and has stopped talking.
    next.say(snapshot(aDownload('a', 'completed')));
    await vi.waitFor(() => {
      expect(follow.seen).toEqual([['a:downloading'], ['a:completed']]);
    });

    expect(follow.fetch).toHaveBeenCalledTimes(2);
    follow.stopped.abort();
    await follow.done;
  });

  it('takes a comment of the engine for a sign that it is there, with nothing to say', async () => {
    const stream = aStream();
    const follow = following([async () => stream.response], undefined, 400);
    stream.say(snapshot(aDownload('a', 'downloading')));

    // Twice the bound and more, a comment every seventh of it: a busy machine has room.
    for (let comments = 0; comments < 15; comments += 1) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      stream.say(': idle\n\n');
    }
    stream.say(snapshot(aDownload('a', 'completed')));
    await vi.waitFor(() => {
      expect(follow.seen).toEqual([['a:downloading'], ['a:completed']]);
    });

    expect(follow.fetch).toHaveBeenCalledOnce();
    expect(follow.warnings).toEqual([]);
    follow.stopped.abort();
    await follow.done;
  });
});
