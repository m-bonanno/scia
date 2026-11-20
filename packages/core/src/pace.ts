// Keeps what arrives under one rate, for everyone who shares it: each asks how long to wait
// before taking more, and what it has just taken is put on the bill of whoever asks next.
// The caller passes the time: no clock in the domain.
//
// The rate is a ceiling, not an average to catch up with: a stretch in which nothing arrived
// earns no credit. The first bytes wait for nothing.
export class Pacer {
  #bytesPerSecond: number | null;
  #freeAtMs = 0;

  constructor(bytesPerSecond: number | null) {
    this.#bytesPerSecond = bytesPerSecond;
  }

  // Null lifts the limit. What was booked under the old one is forgotten: a new limit holds
  // for what arrives from now on.
  limit(bytesPerSecond: number | null): void {
    this.#bytesPerSecond = bytesPerSecond;
    this.#freeAtMs = 0;
  }

  // Books `bytes` that have arrived at `nowMs`, and answers how many milliseconds to wait
  // before taking more.
  book(bytes: number, nowMs: number): number {
    if (this.#bytesPerSecond === null) return 0;
    const startAt = Math.max(nowMs, this.#freeAtMs);
    this.#freeAtMs = startAt + (bytes * 1000) / this.#bytesPerSecond;
    return startAt - nowMs;
  }
}
