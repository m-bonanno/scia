import { createHash } from 'node:crypto';
import { MAX_URLS_PER_REQUEST } from '@scia/contracts';
import { extractLinks } from '@scia/contracts/links';

// How often main reads the clipboard while the switch is on. Electron has no event for a change
// of the clipboard: it is read on a timer, and a link copied is in the list within a second.
export const CLIPBOARD_READ_MS = 1000;

export interface ClipboardWatchDeps {
  // The text on the system's clipboard; it may reject.
  readonly read: () => Promise<string>;
  // Hands links to the engine, which keeps those it knows (docs/adr/0012).
  readonly offer: (links: readonly string[]) => Promise<void>;
  // A timer that beats every `ms` until it is cancelled.
  readonly every: (ms: number, run: () => void) => () => void;
  readonly log: {
    info(message: string, details: object): void;
    warn(message: string, details: object): void;
  };
}

// What was copied is remembered by its digest alone: main keeps no copy of a text that may be a
// password, only what tells it from the next.
function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Main's reading of the clipboard, while the switch is on and only then (#128). What is on the
// clipboard when it is turned on was copied for something else, and is not taken; each text
// copied afterwards is read once, and its http(s) links — nothing else of it — go to the engine,
// one copy at a time.
export class ClipboardWatch {
  readonly #deps: ClipboardWatchDeps;
  #cancel: (() => void) | undefined;
  #seen: string | undefined;
  // A read or an offer under way: one at a time.
  #busy = false;
  // Each turn on or off is a new one: what a read or an offer of an earlier one finds is not
  // this one's to keep.
  #turn = 0;

  constructor(deps: ClipboardWatchDeps) {
    this.#deps = deps;
  }

  watch(on: boolean): void {
    if (on === (this.#cancel !== undefined)) return;
    this.#turn += 1;
    this.#seen = undefined;
    if (!on) {
      this.#cancel?.();
      this.#cancel = undefined;
      this.#busy = false;
      this.#deps.log.info('clipboard_watch_off', {});
      return;
    }
    this.#deps.log.info('clipboard_watch_on', {});
    const turn = this.#turn;
    void this.#oneAtATime(turn, async () => {
      this.#seen = digestOf(await this.#deps.read());
    });
    this.#cancel = this.#deps.every(CLIPBOARD_READ_MS, () => {
      void this.#oneAtATime(turn, () => this.#beat(turn));
    });
  }

  // A beat that comes while a read or an offer is under way does nothing: a text copied while the
  // engine is asked is read at the next beat after its answer. A read the system refuses is passed
  // over, and read again at the next beat.
  async #oneAtATime(turn: number, run: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      await run();
    } catch {
      // Nothing was read; the next beat reads again.
    } finally {
      if (turn === this.#turn) this.#busy = false;
    }
  }

  async #beat(turn: number): Promise<void> {
    const text = await this.#deps.read();
    if (turn !== this.#turn) return;
    const seen = digestOf(text);
    if (seen === this.#seen) return;
    this.#seen = seen;
    const links = extractLinks(text);
    try {
      for (let at = 0; at < links.length; at += MAX_URLS_PER_REQUEST) {
        await this.#deps.offer(links.slice(at, at + MAX_URLS_PER_REQUEST));
      }
    } catch (error) {
      // How many, never which: what a person copies is theirs.
      this.#deps.log.warn('clipboard_links_not_offered', {
        links: links.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
