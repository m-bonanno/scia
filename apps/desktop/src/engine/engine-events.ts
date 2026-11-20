import { API_PREFIX, type Download, SNAPSHOT_EVENT, snapshotSchema } from '@scia/contracts';
import type { EngineAccess } from './engine-access.ts';

export interface SseFrame {
  readonly event: string;
  readonly data: string;
}

// The events of a `text/event-stream`, from its text as it arrives: an event ends at a blank
// line, wherever the pieces were cut.
export class SseFrames {
  #pending = '';

  push(text: string): SseFrame[] {
    const blocks = (this.#pending + text).split(/\r?\n\r?\n/);
    this.#pending = blocks.pop() ?? '';
    return blocks.flatMap((block) => {
      const lines = block.split(/\r?\n/);
      const valueOf = (field: string) =>
        lines
          .filter((line) => line.startsWith(`${field}:`))
          .map((line) => line.slice(field.length + 1).replace(/^ /, ''));
      const data = valueOf('data');
      // A comment, or a block that carries nothing: a stream's way of staying open.
      return data.length === 0
        ? []
        : [{ event: valueOf('event')[0] ?? 'message', data: data.join('\n') }];
    });
  }
}

export interface FollowLog {
  warn(message: string, details: object): void;
}

export interface FollowOptions {
  // Read anew at every attempt: an engine that was started again may be on another port.
  readonly engine: () => EngineAccess;
  readonly onDownloads: (downloads: readonly Download[]) => void;
  // Ends the following: a quit.
  readonly signal: AbortSignal;
  // How long the engine has to begin its answer. The stream itself has no bound: an engine
  // with nothing to say is silent for as long as nothing changes.
  readonly answerLimitMs: number;
  readonly retryMs: number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly log: FollowLog;
}

// Main's own ear on the engine's stream of changes (`GET /events`): each list of downloads is
// handed over as the engine sends it — not asked for on a timer, and not taken from the page,
// which may be hidden. A stream that ends, a refusal, an engine that does not answer: the
// stream is opened again after a wait, until the signal ends it. Resolves then.
export async function followDownloads(options: FollowOptions): Promise<void> {
  // Asked anew after every wait: the quit may have come meanwhile.
  const stopped = () => options.signal.aborted;
  while (!stopped()) {
    try {
      await followOnce(options);
    } catch (error) {
      if (!stopped()) options.log.warn('engine_events_lost', { error: String(error) });
    }
    if (stopped()) return;
    await options.sleep(options.retryMs, options.signal).catch(() => undefined);
  }
}

async function followOnce(options: FollowOptions): Promise<void> {
  const engine = options.engine();
  // One signal for the attempt: the quit ends it, and so does an answer that does not begin.
  const attempt = new AbortController();
  const giveUp = () => {
    attempt.abort();
  };
  options.signal.addEventListener('abort', giveUp, { once: true });
  const silent = setTimeout(giveUp, options.answerLimitMs);
  let closeStream: (() => void) | undefined;
  try {
    const response = await engine.fetch(`${engine.origin}${API_PREFIX}/events`, {
      headers: { authorization: `Bearer ${engine.apiToken}` },
      signal: attempt.signal,
    });
    clearTimeout(silent);
    if (!response.ok || response.body === null) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('The engine did not open its events.');
    }
    const frames = new SseFrames();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    // The stream is closed here, not left to whoever made it: a read that waits on a silent
    // engine ends when the following does.
    closeStream = () => {
      void reader.cancel().catch(() => undefined);
    };
    options.signal.addEventListener('abort', closeStream, { once: true });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      for (const frame of frames.push(decoder.decode(value, { stream: true }))) {
        if (frame.event !== SNAPSHOT_EVENT) continue;
        const downloads = downloadsIn(frame.data);
        if (downloads === undefined) options.log.warn('engine_event_unreadable', {});
        else options.onDownloads(downloads);
      }
    }
  } finally {
    clearTimeout(silent);
    options.signal.removeEventListener('abort', giveUp);
    if (closeStream !== undefined) options.signal.removeEventListener('abort', closeStream);
  }
}

// What the engine sends is checked like any answer from outside main.
function downloadsIn(data: string): readonly Download[] | undefined {
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data.downloads : undefined;
  } catch {
    return undefined;
  }
}
