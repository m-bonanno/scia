import { Pacer } from '@scia/core';

// What a connection books before it reads: Node hands a socket's bytes over in reads of at most
// this, so one booking is one read from a host that keeps up, and several from one that trickles.
const BOOKED_BYTES = 64 * 1024;

// What the limit asks of a connection before a read.
export interface Hold {
  // How long before it reads, as the limit stood when it asked: zero when nothing holds it.
  readonly ms: number;
  // Resolves when it may read; rejects with the signal's reason when the signal ends.
  over(signal: AbortSignal): Promise<void>;
}

// What one connection has booked of the limit, from before it asks its host to its last read.
export interface Allowance {
  // Asked before every read, the first included: books more when what was booked is used up.
  next(): Hold;
  // What a read brought.
  took(bytes: number): void;
  // The connection is done, whatever ended it: what it booked and did not read is given back,
  // what it read beyond its booking is counted.
  settle(): void;
}

const NO_HOLD: Hold = { ms: 0, over: () => Promise.resolve() };

// The speed limit as connections meet it: one for every connection of every download. A
// connection books before it reads, so nothing arrives that the limit has not made room for —
// from the first byte, and with nothing left owed by a download that is paused or removed.
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

  allowance(): Allowance {
    // Booked and not read yet; below zero when a read brought more than was booked.
    let unread = 0;
    let under = this.#changes;
    return {
      next: () => {
        if (unread > 0) return NO_HOLD;
        unread += BOOKED_BYTES;
        under = this.#changes;
        return this.#book(BOOKED_BYTES, () => {
          under = this.#changes;
        });
      },
      took: (bytes) => {
        unread -= bytes;
      },
      settle: () => {
        // A limit that changed since has forgotten this booking: there is nothing to give back.
        if (under === this.#changes) this.#pacer.book(-unread, this.#now());
        unread = 0;
      },
    };
  }

  // `again` is told each time a changed limit has the same bytes booked anew.
  #book(bytes: number, again: () => void): Hold {
    const ms = this.#pacer.book(bytes, this.#now());
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
          waitMs = this.#pacer.book(bytes, this.#now());
          again();
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
