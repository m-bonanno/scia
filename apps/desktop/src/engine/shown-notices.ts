import { failureCode } from './failure-code.ts';

// Where the ids of the notices already shown are kept between launches.
export interface NoticeStore {
  // Whatever is stored: it is checked here, not trusted.
  read(): Promise<unknown>;
  write(shown: readonly string[]): Promise<void>;
}

export interface NoticeLog {
  info(message: string, details: object): void;
  warn(message: string, details: object): void;
}

function idsIn(stored: unknown): string[] {
  return Array.isArray(stored) && stored.every((id) => typeof id === 'string') ? stored : [];
}

// Notices a person needs once. A store that cannot be read or written never stops the app: the
// notice is shown again at the next launch.
export class ShownNotices {
  readonly #store: NoticeStore;
  readonly #log: NoticeLog;
  // What this run already answered: once each, whatever the store does.
  readonly #asked = new Set<string>();
  #writing: Promise<void> = Promise.resolve();

  constructor(store: NoticeStore, log: NoticeLog) {
    this.#store = store;
    this.#log = log;
  }

  // True the first time it is asked about a notice, on any launch. Never after the write: a write
  // waits a while for a file another program holds (#307), and a notice is decided when it is asked.
  async firstTime(id: string): Promise<boolean> {
    if (this.#asked.has(id)) return false;
    this.#asked.add(id);
    const shown = await this.#store.read().then(idsIn, (): string[] => []);
    if (shown.includes(id)) return false;
    this.#keep(id);
    return true;
  }

  // One write at a time, each from the file as the last one left it: two at once would share its
  // `.tmp`, and the later rename would find it gone.
  #keep(id: string): void {
    const write = async () => {
      const shown = await this.#store.read().then(idsIn, (): string[] => []);
      if (shown.includes(id)) return;
      const failed = await this.#store.write([...shown, id]).then(
        () => undefined,
        (error: unknown) => ({ error }),
      );
      if (failed === undefined) {
        this.#log.info('notices_kept', { notice: id });
      } else {
        // The store tried a while: another program held the file throughout, or the disk refused.
        this.#log.warn('notices_not_kept', { notice: id, code: failureCode(failed.error) });
      }
    };
    this.#writing = this.#writing.then(write, write);
  }
}
