import { createHash } from 'node:crypto';
import { MAX_URLS_PER_REQUEST } from '@scia/contracts';
import { extractLinks, extractMagnets } from '@scia/contracts/links';

// How often main reads the clipboard while the switch is on. Electron has no event for a change
// of the clipboard: it is read on a timer, and a link copied is in the list within a second.
export const CLIPBOARD_READ_MS = 1000;
// What a turn knows when the clipboard held no text at its start.
const EMPTY = Symbol('empty');

export interface ClipboardWatchDeps {
  // The text on the system's clipboard; it may reject, or answer '' for a clipboard it could not
  // open.
  readonly read: () => Promise<string>;
  // Whether the clipboard holds text, from its formats: Windows tells them without opening the
  // clipboard, so a clipboard another program holds open still says it holds text.
  readonly holdsText: () => Promise<boolean>;
  // Hands links to the engine, which keeps those it knows (docs/adr/0012); answers how many it
  // added.
  readonly offer: (links: readonly string[]) => Promise<number>;
  // How many links of one copy were added, said once for the copy.
  readonly added: (count: number) => void;
  // Hands magnets to the engine, which sends them to the connected service, or leaves them out
  // with none (#139; docs/adr/0017); answers how many it sent.
  readonly offerMagnets: (magnets: readonly string[]) => Promise<number>;
  // How many magnets of one copy were sent, said once for the copy.
  readonly sent: (count: number) => void;
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
// copied afterwards is read once, and its http(s) links and its magnets (#139) — nothing else of
// it — go to the engine, one copy at a time.
export class ClipboardWatch {
  readonly #deps: ClipboardWatchDeps;
  #cancel: (() => void) | undefined;
  // What this turn knows was there: the digest of the last text read, or `EMPTY`. Undefined until
  // the clipboard's formats or a read of this turn have told it — nothing is offered before.
  #seen: string | typeof EMPTY | undefined;
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
    // The first beat at once: it learns what is there.
    beat();
  }

  // A beat that comes while a read or an offer is under way does nothing: a text copied while the
  // engine is asked is read at the next beat after its answer. A read the system refuses — of the
  // text or of the formats — is passed over, and read again at the next beat.
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
    // Electron answers an empty text when the system will not open the clipboard, as for a
    // clipboard that holds no text: until this turn knows what was there, the clipboard's formats
    // are asked first. A clipboard with no text then — empty, a picture, files — is known at once,
    // and a text read after that answer was copied after it; one that holds text is known only
    // once its text is read, however long the system keeps it closed (#134).
    if (this.#seen === undefined) {
      const holdsText = await this.#deps.holdsText();
      if (turn !== this.#turn) return;
      if (!holdsText) this.#know(EMPTY);
    }
    const text = await this.#deps.read();
    if (turn !== this.#turn) return;
    // An empty read tells nothing from the copy before it, and is passed over.
    if (text === '') return;
    const seen = digestOf(text);
    const known = this.#seen;
    if (known === undefined) {
      this.#know(seen);
      return;
    }
    this.#seen = seen;
    if (seen === known) return;
    await this.#offer(turn, extractLinks(text));
    // Turned off while the links were on their way: the magnets of the copy are not this turn's.
    if (turn === this.#turn) await this.#offerMagnets(turn, extractMagnets(text));
  }

  // What was on the clipboard when the reading started: whether it held text, never what.
  #know(seen: string | typeof EMPTY): void {
    this.#seen = seen;
    this.#deps.log.info('clipboard_start_known', { text: seen !== EMPTY });
  }

  async #offerMagnets(turn: number, magnets: readonly string[]): Promise<void> {
    let sent = 0;
    try {
      for (let at = 0; at < magnets.length; at += MAX_URLS_PER_REQUEST) {
        sent += await this.#deps.offerMagnets(magnets.slice(at, at + MAX_URLS_PER_REQUEST));
        // Turned off meanwhile: the rest of the copy is not sent, and what was is not said.
        if (turn !== this.#turn) return;
      }
    } catch (error) {
      // How many, never which: a magnet names a person's torrent.
      this.#deps.log.warn('clipboard_magnets_not_offered', {
        magnets: magnets.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (sent > 0) this.#deps.sent(sent);
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
