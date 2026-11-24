import { DEFAULT_THEME, type Theme, THEMES } from '@scia/contracts/theme';
import { failureCode } from './failure-code.ts';

// Where main keeps the theme between launches.
export interface ThemeStore {
  // Whatever is stored: it is checked here, not trusted.
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

export interface ThemeLog {
  info(message: string, details: object): void;
  warn(message: string, details: object): void;
}

const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme === value);

// The theme the engine last said, kept by main for the next start: the window shows in it before
// the engine can say it (#13). The engine keeps the person's choice; this is only its echo, and a
// store that cannot be read or written never stops anything — the window starts in the default.
export class RememberedTheme {
  readonly #store: ThemeStore;
  readonly #log: ThemeLog;
  #kept: Theme | undefined;
  #wanted: Theme | undefined;
  #writing: Promise<void> | undefined;

  constructor(store: ThemeStore, log: ThemeLog) {
    this.#store = store;
    this.#log = log;
  }

  async read(): Promise<Theme> {
    const stored: unknown = await this.#store.read().catch(() => undefined);
    const theme =
      typeof stored === 'object' && stored !== null ? (stored as { theme?: unknown }).theme : null;
    if (!isTheme(theme)) return DEFAULT_THEME;
    this.#kept = theme;
    return theme;
  }

  // One write at a time, the theme asked last winning: two writes of one file at once land in the
  // order they like, and a late one, or a torn one, would start the next window in another theme.
  // What is kept is what landed: a write that failed leaves it unknown, so the next is made.
  keep(theme: Theme): Promise<void> {
    this.#wanted = theme;
    if (this.#writing !== undefined) return this.#writing;
    if (theme === this.#kept) return Promise.resolve();
    this.#writing = this.#writeWanted();
    return this.#writing;
  }

  async #writeWanted(): Promise<void> {
    try {
      for (let theme = this.#wanted; theme !== this.#kept; theme = this.#wanted) {
        // What is kept follows the write alone, whatever its line in the log does.
        const failed = await this.#store.write({ theme }).then(
          () => undefined,
          (error: unknown) => ({ error }),
        );
        if (failed === undefined) {
          this.#kept = theme;
          this.#log.info('theme_kept', { theme });
        } else {
          // Written again the next time the engine says it — or now, when it has said another.
          // The store tried a while: another program held the file throughout, or the disk refused.
          this.#kept = undefined;
          this.#log.warn('theme_not_kept', { theme, code: failureCode(failed.error) });
          if (this.#wanted === theme) return;
        }
      }
    } finally {
      this.#writing = undefined;
    }
  }
}
