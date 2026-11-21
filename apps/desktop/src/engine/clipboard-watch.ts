import { createHash } from 'node:crypto';
import { MAX_URLS_PER_REQUEST } from '@scia/contracts';
import { extractLinks } from '@scia/contracts/links';

// How often main reads the clipboard while the switch is on. Electron has no event for a change
// of the clipboard: it is read on a timer, and a link copied is in the list within a second.
export const CLIPBOARD_READ_MS = 1000;
// Empty reads in a row, at the start, that make a clipboard empty rather than one the system did
// not open.
const EMPTY_READS_FOR_EMPTY = 3;
// What a turn knows when the clipboard held no text at its start.
const EMPTY = Symbol('empty');

export interface ClipboardWatchDeps {
  // The text on the system's clipboard; it may reject, or answer '' for a clipboard it could not
  // open.
  readonly read: () => Promise<string>;
  // Hands links to the engine, which keeps those it knows (docs/adr/0012); answers how many it
  // added.
  readonly offer: (links: readonly string[]) => Promise<number>;
  // How many links of one copy were added, said once for the copy.
  readonly added: (count: number) => void;
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
  // What this turn knows was there: the digest of the last text read, or `EMPTY`. Undefined until
  // a read of this turn has told it — nothing is offered before.
  #seen: string | typeof EMPTY | undefined;
  // Empty reads in a row while nothing is known yet.
  #emptyReads = 0;
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
    this.#emptyReads = 0;
    // What a read or an offer of the turn before holds is not this turn's to wait for.
    this.#busy = false;
    if (!on) {
      this.#cancel?.();
      this.#cancel = undefined;
      this.#deps.log.info('clipboard_watch_off', {});
      return;
    }
    this.#deps.log.info('clipboard_watch_on', {});
    const turn = this.#turn;
    const beat = () => {
      void this.#oneAtATime(turn, () => this.#beat(turn));
    };
    this.#cancel = this.#deps.every(CLIPBOARD_READ_MS, beat);
    // The first beat at once: it learns what is there, and offers nothing.
    beat();
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
    // Electron answers an empty text when the system will not open the clipboard, as for a
    // clipboard that holds no text: an empty read tells nothing from the copy before it, and is
    // passed over — but a few in a row, before anything is known, are a clipboard that is empty.
    if (text === '') {
      if (this.#seen === undefined && ++this.#emptyReads >= EMPTY_READS_FOR_EMPTY) {
        this.#seen = EMPTY;
      }
      return;
    }
    const seen = digestOf(text);
    const known = this.#seen;
    this.#seen = seen;
    if (known === undefined || seen === known) return;
    await this.#offer(turn, extractLinks(text));
  }

  async #offer(turn: number, links: readonly string[]): Promise<void> {
    let added = 0;
    try {
      for (let at = 0; at < links.length; at += MAX_URLS_PER_REQUEST) {
        added += await this.#deps.offer(links.slice(at, at + MAX_URLS_PER_REQUEST));
        // Turned off meanwhile: the rest of the copy is not this turn's to hand over or to say.
        if (turn !== this.#turn) return;
      }
    } catch (error) {
      // How many, never which: what a person copies is theirs.
      this.#deps.log.warn('clipboard_links_not_offered', {
        links: links.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (added > 0) this.#deps.added(added);
  }
}
