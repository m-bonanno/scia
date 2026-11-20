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
  info(message: string, details: object): void;
  warn(message: string, details: object): void;
}

export interface FollowOptions {
  // Read anew at every attempt: an engine that was started again may be on another port.
  readonly engine: () => EngineAccess;
  readonly onDownloads: (downloads: readonly Download[]) => void;
  // Ends the following: a quit.
  readonly signal: AbortSignal;
  // How long the engine has to begin its answer.
  readonly answerLimitMs: number;
  // How long the stream may say nothing at all once it is open. The engine writes a comment
  // when it has nothing to send (EVENTS_KEEP_ALIVE_MS): a longer silence is an engine that
  // stopped talking, and the stream is given up before the client's own timer cuts it.
  readonly silenceLimitMs: number;
  readonly retryMs: number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly log: FollowLog;
}

// Main's own ear on the engine's stream of changes (`GET /events`): each list of downloads is
// handed over as the engine sends it — not asked for on a timer, and not taken from the page,
// which may be hidden. A stream that ends, a refusal, an engine that does not answer or goes
// silent: the stream is opened again after a wait, until the signal ends it. Resolves then.
export async function followDownloads(options: FollowOptions): Promise<void> {
  // Asked anew after every wait: the quit may have come meanwhile.
  const stopped = () => options.signal.aborted;
  // Said once when the events are lost and once when they are back, not at every attempt.
  let lost = false;
  const opened = () => {
    if (lost) options.log.info('engine_events_back', {});
    lost = false;
  };
  while (!stopped()) {
    const reason = await followOnce(options, opened).then(
      () => 'The engine closed its events.',
      (error: unknown) => String(error),
    );
    if (stopped()) return;
    if (!lost) options.log.warn('engine_events_lost', { reason });
    lost = true;
    await options.sleep(options.retryMs, options.signal).catch(() => undefined);
  }
}

// Resolves when the engine ends the stream; rejects for everything else that ends it.
async function followOnce(options: FollowOptions, opened: () => void): Promise<void> {
  const engine = options.engine();
  // One signal for the attempt: the quit ends it, and so does an engine that says nothing.
  const attempt = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const giveUp = () => {
    attempt.abort();
    // The stream is closed here, not left to whoever made it: a read that waits on a silent
    // engine ends when the attempt does.
    void reader?.cancel().catch(() => undefined);
  };
  options.signal.addEventListener('abort', giveUp, { once: true });
  let silent = setTimeout(giveUp, options.answerLimitMs);
  // Set by the timer while a read waits, and looked at when the read comes back.
  const silence = { fell: false };
  const heard = () => {
    clearTimeout(silent);
    silent = setTimeout(() => {
      silence.fell = true;
      giveUp();
    }, options.silenceLimitMs);
  };
  try {
    const response = await engine.fetch(`${engine.origin}${API_PREFIX}/events`, {
      headers: { authorization: `Bearer ${engine.apiToken}` },
      signal: attempt.signal,
    });
    if (!response.ok || response.body === null) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('The engine did not open its events.');
    }
    heard();
    opened();
    reader = response.body.getReader();
    const frames = new SseFrames();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (silence.fell) throw new Error('The engine went silent.');
      if (done) return;
      // Anything at all, a comment included: the engine is there.
      heard();
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
