// Holds everything that books with it under one rate. A ceiling, not an average to catch up
// with: a stretch with nothing to download earns no credit.
export class Pacer {
  #bytesPerSecond: number | null;
  #freeAtMs = 0;
  #askedAtMs = 0;

  constructor(bytesPerSecond: number | null) {
    this.#bytesPerSecond = bytesPerSecond;
  }

  // Null lifts the limit. What was booked under the old one is forgotten.
  limit(bytesPerSecond: number | null): void {
    this.#bytesPerSecond = bytesPerSecond;
    this.#freeAtMs = 0;
  }

  // Books `bytes` at `nowMs` and answers how long whoever books them waits: the time everything
  // booked before still needs. Nothing booked asks for the wait of whoever comes next; a count
  // below zero gives back what was booked and will not be taken.
  book(bytes: number, nowMs: number): number {
    // A clock that steps back would turn its step into a wait: what is owed moves back with it.
    if (nowMs < this.#askedAtMs) this.#freeAtMs -= this.#askedAtMs - nowMs;
    this.#askedAtMs = nowMs;
    if (this.#bytesPerSecond === null) return 0;
    const startAt = Math.max(nowMs, this.#freeAtMs);
    this.#freeAtMs = startAt + (bytes * 1000) / this.#bytesPerSecond;
    return startAt - nowMs;
  }
}
