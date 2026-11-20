// Holds things so that they are not collected while they may still be needed — a notification
// that can still be clicked — and no more than `limit` of them: the oldest goes when a new one
// would pass it.
export class Kept<T> {
  readonly #limit: number;
  #things: T[] = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  keep(thing: T): void {
    this.#things = [...this.#things, thing].slice(-this.#limit);
  }

  release(thing: T): void {
    this.#things = this.#things.filter((kept) => kept !== thing);
  }

  held(): readonly T[] {
    return this.#things;
  }
}
