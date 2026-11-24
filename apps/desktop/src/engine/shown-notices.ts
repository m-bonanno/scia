import { failureCode } from './failure-code.ts';

// Where the ids of the notices already shown are kept between launches.
export interface NoticeStore {
  // Whatever is stored: it is checked here, not trusted.
  read(): Promise<unknown>;
  write(shown: readonly string[]): Promise<void>;
}

export interface NoticeLog {
  warn(message: string, details: object): void;
}

function idsIn(stored: unknown): string[] {
  return Array.isArray(stored) && stored.every((id) => typeof id === 'string') ? stored : [];
}

// Notices a person needs once. A store that cannot be read or written never stops the app: the
// notice is simply shown again.
export class ShownNotices {
  readonly #store: NoticeStore;
  readonly #log: NoticeLog;

  constructor(store: NoticeStore, log: NoticeLog) {
    this.#store = store;
    this.#log = log;
  }

  // True the first time it is asked about a notice, on any launch.
  async firstTime(id: string): Promise<boolean> {
    const shown = await this.#store.read().then(idsIn, (): string[] => []);
    if (shown.includes(id)) return false;
    // The store tried a while: another program held the file throughout, or the disk refused.
    await this.#store.write([...shown, id]).catch((error: unknown) => {
      this.#log.warn('notices_not_kept', { notice: id, code: failureCode(error) });
    });
    return true;
  }
}
