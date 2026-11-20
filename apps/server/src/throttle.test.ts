import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Throttle } from './throttle.ts';

// What a connection books before a read. At this many bytes a second, a booking is a second.
const BOOKED = 64 * 1024;

describe('Throttle', () => {
  let clockMs: number;
  const now = () => clockMs;
  const pass = async (ms: number) => {
    clockMs += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  // Whether a wait is over, without waiting for it.
  const watch = (wait: Promise<void>) => {
    const state = { over: false, failure: undefined as unknown };
    wait.then(
      () => (state.over = true),
      (error: unknown) => (state.failure = error),
    );
    return state;
  };
  const never = new AbortController().signal;

  beforeEach(() => {
    clockMs = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds nobody while there is no limit', async () => {
    const allowance = new Throttle(null, now).allowance();

    const holds = [allowance.next(), allowance.next()];
    allowance.took(50_000_000);
    holds.push(allowance.next());

    expect(holds.map((hold) => hold.ms)).toEqual([0, 0, 0]);
    await holds[2]!.over(never);
  });

  it('makes room before a read, for one connection after the other', () => {
    const throttle = new Throttle(BOOKED, now);

    const holds = [1, 2, 3].map(() => throttle.allowance().next().ms);

    expect(holds).toEqual([0, 1000, 2000]);
  });

  it('books again only when what was booked has been read', () => {
    const throttle = new Throttle(BOOKED, now);
    const trickling = throttle.allowance();
    trickling.next();

    trickling.took(1000);
    expect(trickling.next().ms).toBe(0);
    // Nothing more was booked for it: another connection waits for the one booking only.
    expect(throttle.allowance().next().ms).toBe(1000);

    trickling.took(BOOKED - 1000);
    expect(trickling.next().ms).toBe(2000);
  });

  it('gives back what a connection booked and did not read', () => {
    const throttle = new Throttle(BOOKED, now);
    const small = throttle.allowance();
    small.next();

    small.took(BOOKED / 4);
    small.settle();

    expect(throttle.allowance().next().ms).toBe(250);
  });

  it('counts what a read brought beyond the booking', () => {
    const throttle = new Throttle(BOOKED, now);
    const generous = throttle.allowance();
    generous.next();

    generous.took(2 * BOOKED);
    generous.settle();

    expect(throttle.allowance().next().ms).toBe(2000);
  });

  it('lets a connection read when its turn comes, not before', async () => {
    const throttle = new Throttle(BOOKED, now);
    throttle.allowance().next();
    const wait = watch(throttle.allowance().next().over(never));

    await pass(999);
    expect(wait.over).toBe(false);
    await pass(1);
    expect(wait.over).toBe(true);
  });

  it('ends a wait with its signal, gives its booking back, and leaves the others waiting', async () => {
    const throttle = new Throttle(BOOKED, now);
    throttle.allowance().next();
    const stopped = new AbortController();
    const paused = throttle.allowance();
    const pausedWait = watch(paused.next().over(stopped.signal));
    const otherWait = watch(throttle.allowance().next().over(never));

    stopped.abort(new Error('paused'));
    await pass(0);
    paused.settle();

    expect(pausedWait.failure).toEqual(new Error('paused'));
    expect(otherWait.over).toBe(false);
    // Three were booked and one was given back: the next waits two seconds, not three.
    expect(throttle.allowance().next().ms).toBe(2000);
    await pass(2000);
    expect(otherWait.over).toBe(true);
  });

  it('does not start a wait for a signal that has already ended', async () => {
    const throttle = new Throttle(BOOKED, now);
    throttle.allowance().next();

    await expect(
      throttle
        .allowance()
        .next()
        .over(AbortSignal.abort(new Error('paused'))),
    ).rejects.toThrow('paused');
  });

  it('frees at once who waits when the limit is lifted', async () => {
    const throttle = new Throttle(BOOKED, now);
    const waits = [1, 2, 3, 4].map(() => watch(throttle.allowance().next().over(never)));
    await pass(0);
    expect(waits.map((wait) => wait.over)).toEqual([true, false, false, false]);

    throttle.limit(null);
    await pass(0);

    expect(waits.map((wait) => wait.over)).toEqual([true, true, true, true]);
  });

  it('has who waits wait again under the new limit when it changes', async () => {
    const throttle = new Throttle(BOOKED, now);
    throttle.allowance().next();
    const first = watch(throttle.allowance().next().over(never));
    const second = watch(throttle.allowance().next().over(never));

    throttle.limit(2 * BOOKED);
    await pass(0);
    // The first to ask again finds the line free; the second waits for the first one's read.
    expect([first.over, second.over]).toEqual([true, false]);
    await pass(500);
    expect(second.over).toBe(true);
  });

  it('does not wait under a limit that changed between the asking and the wait', async () => {
    const throttle = new Throttle(BOOKED, now);
    throttle.allowance().next();
    const hold = throttle.allowance().next();

    throttle.limit(null);
    const wait = watch(hold.over(never));
    await pass(0);

    expect(wait.over).toBe(true);
  });

  it('gives nothing back to a limit that has forgotten the booking', () => {
    const throttle = new Throttle(BOOKED, now);
    const before = throttle.allowance();
    before.next();

    throttle.limit(BOOKED);
    throttle.allowance().next();
    before.settle();

    // The one booking made since the change stands whole.
    expect(throttle.allowance().next().ms).toBe(1000);
  });

  it('gives back a booking it made again under the new limit', async () => {
    const throttle = new Throttle(BOOKED, now);
    throttle.allowance().next();
    const waiting = throttle.allowance();
    const wait = watch(waiting.next().over(never));

    throttle.limit(BOOKED);
    await pass(0);
    expect(wait.over).toBe(true);
    throttle.allowance().next();
    waiting.settle();

    expect(throttle.allowance().next().ms).toBe(1000);
  });
});
