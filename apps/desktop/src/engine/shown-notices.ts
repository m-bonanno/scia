// Where the ids of the notices already shown are kept between launches.
export interface NoticeStore {
  // Whatever is stored: it is checked here, not trusted.
  read(): Promise<unknown>;
  write(shown: readonly string[]): Promise<void>;
}

function idsIn(stored: unknown): string[] {
  return Array.isArray(stored) && stored.every((id) => typeof id === 'string') ? stored : [];
}

// Notices a person needs once. A store that cannot be read or written never stops the app: the
// notice is simply shown again.
export class ShownNotices {
  readonly #store: NoticeStore;

  constructor(store: NoticeStore) {
    this.#store = store;
  }

  // True the first time it is asked about a notice, on any launch.
  async firstTime(id: string): Promise<boolean> {
    const shown = await this.#store.read().then(idsIn, (): string[] => []);
    if (shown.includes(id)) return false;
    await this.#store.write([...shown, id]).catch(() => undefined);
    return true;
  }
}
