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
  // Asked before every read, the first included: books up to a whole read when what is booked
  // no longer covers a read of the size the connection makes.
  next(): Hold;
  // What a read brought.
  took(bytes: number): void;
  // The connection is done, whatever ended it: what it booked and did not read is given back.
  settle(): void;
}

const NO_HOLD: Hold = { ms: 0, over: () => Promise.resolve() };

// The speed limit as connections meet it: one for every connection of every download. A
// connection reads only against room booked before the read — a whole read's before its first,
// then room for the largest read it has made — and gives back what it did not read, so a
// download that is paused or removed leaves nothing owed.
//
// Nothing is read that the limit has not made room for, from the first byte, but for three
// things, each with its bound:
// 1. when a limit is set or lowered, each connection in the middle of a read finishes that
//    read — one read at most — and pays for it before its next;
// 2. a read larger than any its connection has made before passes what was booked by the
//    difference — less than one read over the connection's whole life — and is paid for
//    before the next;
// 3. a booking may start up to 50 ms in the past, so that a wait that ends late is caught up
//    (`Pacer`): the limit is passed by no more than 50 ms' worth of it, and nothing beyond
//    that is ever caught up.
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
    // What a read of this connection brings: a whole one until it has made one. Over an
    // encrypted connection a read is a record of 16 KB, and one booking covers four.
    let aRead = READ_BYTES;
    let hasRead = false;
    let under = this.#changes;
    // A limit that changed has forgotten what was booked with the old one.
    const current = () => {
      if (under === this.#changes) return;
      unread = 0;
      under = this.#changes;
    };
    // Books what is missing to a whole read, when what is booked does not cover the next, and
    // answers the wait for it.
    const book = (): number => {
      current();
      if (unread >= Math.min(aRead, left)) return 0;
      const missing = Math.min(Math.max(READ_BYTES, aRead), left) - unread;
      unread += missing;
      return this.#pacer.book(missing, this.#now());
    };
    return {
      next: () => this.#hold(book(), book),
      took: (bytes) => {
        current();
        unread -= bytes;
        left = Math.max(0, left - bytes);
        aRead = hasRead ? Math.max(aRead, bytes) : bytes;
        hasRead = true;
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
