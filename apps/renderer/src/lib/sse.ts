export interface ServerSentEvent {
  readonly event: string;
  readonly data: string;
}

// The text/event-stream format, fed in pieces as the network delivers them: an event ends at a
// blank line, and a piece may end in the middle of anything.
export class SseParser {
  #buffer = '';
  #event = '';
  #data: string[] = [];

  push(text: string): ServerSentEvent[] {
    this.#buffer += text;
    const lines = this.#buffer.split(/\r\n|\n|\r/);
    this.#buffer = lines.pop() ?? '';
    const events: ServerSentEvent[] = [];
    for (const line of lines) {
      if (line === '') {
        if (this.#data.length > 0) {
          events.push({
            event: this.#event === '' ? 'message' : this.#event,
            data: this.#data.join('\n'),
          });
        }
        this.#event = '';
        this.#data = [];
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') this.#event = value;
        if (field === 'data') this.#data.push(value);
      }
    }
    return events;
  }
}

export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}
