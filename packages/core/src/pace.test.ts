import { describe, expect, it } from 'vitest';
import { Pacer } from './pace.ts';

describe('Pacer', () => {
  it('asks for no wait while there is no limit', () => {
    const pacer = new Pacer(null);

    expect(pacer.book(50_000_000, 0)).toBe(0);
    expect(pacer.book(50_000_000, 0)).toBe(0);
  });

  it('lets the first bytes pass at once, and has what follows wait its turn', () => {
    const pacer = new Pacer(1000);

    expect(pacer.book(500, 0)).toBe(0);
    expect(pacer.book(500, 0)).toBe(500);
    expect(pacer.book(500, 0)).toBe(1000);
  });

  it('counts the time that has passed since', () => {
    const pacer = new Pacer(1000);
    pacer.book(1000, 0);

    expect(pacer.book(1000, 400)).toBe(600);
    expect(pacer.book(1, 5000)).toBe(0);
  });

  it('makes up for a wait that ended late, so that the line does not fall behind for it', () => {
    // Ten milliseconds a booking.
    const pacer = new Pacer(100_000);
    pacer.book(1000, 0);
    expect(pacer.book(1000, 0)).toBe(10);

    // The wait of ten was thirty late, as a system's timer is: three bookings follow at once,
    // where the line had been free, and the fourth waits again.
    const waits = [1, 2, 3, 4].map(() => pacer.book(1000, 40));

    expect(waits).toEqual([0, 0, 0, 10]);
  });

  it('makes up for no more than a twentieth of a second: the rate is a ceiling, not an average', () => {
    const pacer = new Pacer(1000);
    pacer.book(1, 0);

    // A minute with nothing to download earns fifty milliseconds, not a minute.
    expect(pacer.book(1000, 60_000)).toBe(0);
    expect(pacer.book(1000, 60_000)).toBe(950);
  });

  it('holds everyone who books together under the one rate', () => {
    const pacer = new Pacer(8000);
    const waits = Array.from({ length: 8 }, () => pacer.book(1000, 0));

    expect(waits).toEqual([0, 125, 250, 375, 500, 625, 750, 875]);
  });

  it('does not take a clock that steps back for time still to wait', () => {
    const pacer = new Pacer(1000);
    pacer.book(1000, 60_000);
    expect(pacer.book(1000, 60_000)).toBe(950);

    // A minute earlier than the last time it was asked: the wait is what was booked — the two
    // seconds, less the fifty milliseconds the first booking made up — and no minute more.
    expect(pacer.book(1000, 0)).toBe(1950);
    expect(pacer.book(1, 500)).toBe(2450);
  });

  it('answers a booking of nothing with the wait of whoever comes next', () => {
    const pacer = new Pacer(1000);
    pacer.book(2000, 0);

    expect(pacer.book(0, 500)).toBe(1500);
    expect(pacer.book(0, 500)).toBe(1500);
  });

  it('takes back what was booked and will not be taken', () => {
    const pacer = new Pacer(1000);
    pacer.book(1000, 0);
    pacer.book(1000, 0);

    pacer.book(-1000, 0);

    expect(pacer.book(0, 0)).toBe(1000);
  });

  it('gives no more credit than that for what is given back when nothing is owed', () => {
    const pacer = new Pacer(1000);

    pacer.book(-60_000, 0);

    expect(pacer.book(1000, 0)).toBe(0);
    expect(pacer.book(1, 0)).toBe(950);
  });

  it('forgets what was booked when the limit changes, and lifts it at once', () => {
    const pacer = new Pacer(1000);
    pacer.book(10_000, 0);

    pacer.limit(null);
    expect(pacer.book(10_000, 0)).toBe(0);

    pacer.limit(2000);
    expect(pacer.book(2000, 0)).toBe(0);
    expect(pacer.book(1, 0)).toBe(1000);
  });
});
