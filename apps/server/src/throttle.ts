import { Pacer } from '@scia/core';

// The most a read brings: Node hands a socket's bytes over in pieces of at most this.
const READ_BYTES = 64 * 1024;

// What the limit asks of a connection before a read.
export interface Hold {
  // How long before it reads, as the limit stood when it asked: zero when nothing holds it.
  readonly ms: number;
  // Resolves when it may read; rejects with the signal's reason when the signal ends.
  over(signal: AbortSignal): Promise<void>;
}

// What one connection has booked of the limit, from before it asks its host to its last read.
export interface Allowance {
  // Asked before every read, the first included: books what is missing to a whole read.
  next(): Hold;
  // What a read brought.
  took(bytes: number): void;
  // The connection is done, whatever ended it: what it booked and did not read is given back.
  settle(): void;
}

const NO_HOLD: Hold = { ms: 0, over: () => Promise.resolve() };

// The speed limit as connections meet it: one for every connection of every download. A
// connection reads only against room for a whole read, booked before it: nothing is read that
// the limit has not made room for — from the first byte, and with nothing left owed by a
// download that is paused or removed. The one exception is a read already under way when a
// limit is set or lowered: it is taken, and paid for before the next.
export class Throttle {
  readonly #pacer: Pacer;
  readonly #now: () => number;
  readonly #waiting = new Set<() => void>();
  #changes = 0;

  // The clock is one that never steps: on the system's, a correction of an hour would be an
  // hour without a byte.
  constructor(bytesPerSecond: number | null, now: () => number = () => performance.now()) {
    this.#pacer = new Pacer(bytesPerSecond);
    this.#now = now;
  }

  // At once, also for who is waiting: their wait was measured under the old limit.
  limit(bytesPerSecond: number | null): void {
    this.#pacer.limit(bytesPerSecond);
    this.#changes += 1;
    for (const wake of [...this.#waiting]) wake();
  }

  // `expectedBytes` is what the connection's range can bring, when its host says: a small file
  // books its own size, not a whole read's turn.
  allowance(expectedBytes: number | null = null): Allowance {
    // Booked and not read yet; below zero for a read made without a booking.
    let unread = 0;
    let left = expectedBytes ?? Number.POSITIVE_INFINITY;
    let under = this.#changes;
    // A limit that changed has forgotten what was booked with the old one.
    const current = () => {
      if (under === this.#changes) return;
      unread = 0;
      under = this.#changes;
    };
    // Books what is missing to a whole read and answers the wait for it.
    const book = (): number => {
      current();
      const missing = Math.min(READ_BYTES, left) - unread;
      if (missing <= 0) return 0;
      unread += missing;
      return this.#pacer.book(missing, this.#now());
    };
    return {
      next: () => this.#hold(book(), book),
      took: (bytes) => {
        current();
        unread -= bytes;
        left = Math.max(0, left - bytes);
      },
      settle: () => {
        current();
        this.#pacer.book(-unread, this.#now());
        unread = 0;
      },
    };
  }

  // `again` books anew, and answers the new wait, each time the limit changes meanwhile.
  #hold(ms: number, again: () => number): Hold {
    if (ms <= 0) return NO_HOLD;
    const booked = this.#changes;
    return {
      ms,
      over: async (signal) => {
        let waitMs = ms;
        let under = booked;
        for (;;) {
          if (under === this.#changes && (waitMs <= 0 || (await this.#sleep(waitMs, signal)))) {
            return;
          }
          under = this.#changes;
          waitMs = again();
        }
      },
    };
  }

  // Answers whether the time passed: false when the limit changed first.
  #sleep(ms: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason as Error);
        return;
      }
      const leave = () => {
        clearTimeout(timer);
        this.#waiting.delete(woken);
        signal.removeEventListener('abort', stopped);
      };
      const woken = () => {
        leave();
        resolve(false);
      };
      const stopped = () => {
        leave();
        reject(signal.reason as Error);
      };
      const timer = setTimeout(() => {
        leave();
        resolve(true);
      }, ms);
      this.#waiting.add(woken);
      signal.addEventListener('abort', stopped, { once: true });
    });
  }
}
