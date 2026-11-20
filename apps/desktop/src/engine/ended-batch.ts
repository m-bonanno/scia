import type { Ended } from './ended-downloads.ts';

// How long a download that ended waits for others to end with it: one notification counts
// them, where each on its own would bury the screen under a playlist.
export const GATHER_MS = 2000;

export interface EndedBatchOptions {
  readonly gatherMs?: number;
  // Runs `run` after `ms`, and answers how to call it off.
  readonly wait: (ms: number, run: () => void) => () => void;
  readonly deliver: (ended: readonly Ended[]) => void;
}

// Gathers the downloads that end close together. The wait is counted from the first of them:
// a download is never kept waiting by the ones that end after it.
export class EndedBatch {
  readonly #options: EndedBatchOptions;
  readonly #gathered = new Map<string, Ended>();
  #callOff: (() => void) | undefined;
  #stopped = false;

  constructor(options: EndedBatchOptions) {
    this.#options = options;
  }

  add(ended: readonly Ended[]): void {
    if (this.#stopped || ended.length === 0) return;
    for (const download of ended) {
      // A download that ended twice within the wait — failed, tried again — is said once, as
      // it ended last, and in the place of that end.
      this.#gathered.delete(download.id);
      this.#gathered.set(download.id, download);
    }
    this.#callOff ??= this.#options.wait(this.#options.gatherMs ?? GATHER_MS, () => {
      this.#callOff = undefined;
      const gathered = [...this.#gathered.values()];
      this.#gathered.clear();
      this.#options.deliver(gathered);
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#callOff?.();
    this.#callOff = undefined;
    this.#gathered.clear();
  }
}
