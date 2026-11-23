import { DEFAULT_THEME, type Theme, THEMES } from '@scia/contracts/theme';

// Where main keeps the theme between launches.
export interface ThemeStore {
  // Whatever is stored: it is checked here, not trusted.
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme === value);

// The theme the engine last said, kept by main for the next start: the window shows in it before
// the engine can say it (#13). The engine keeps the person's choice; this is only its echo, and a
// store that cannot be read or written never stops anything — the window starts in the default.
export class RememberedTheme {
  readonly #store: ThemeStore;
  #kept: Theme | undefined;

  constructor(store: ThemeStore) {
    this.#store = store;
  }

  async read(): Promise<Theme> {
    const stored: unknown = await this.#store.read().catch(() => undefined);
    const theme =
      typeof stored === 'object' && stored !== null ? (stored as { theme?: unknown }).theme : null;
    if (!isTheme(theme)) return DEFAULT_THEME;
    this.#kept = theme;
    return theme;
  }

  async keep(theme: Theme): Promise<void> {
    if (theme === this.#kept) return;
    try {
      await this.#store.write({ theme });
      this.#kept = theme;
    } catch {
      // Written again the next time the engine says it.
    }
  }
}
