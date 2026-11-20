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

  it('gives no credit for a stretch with nothing to download: the rate is a ceiling', () => {
    const pacer = new Pacer(1000);
    pacer.book(1, 0);

    expect(pacer.book(1000, 60_000)).toBe(0);
    expect(pacer.book(1000, 60_000)).toBe(1000);
  });

  it('holds everyone who books together under the one rate', () => {
    const pacer = new Pacer(8000);
    const waits = Array.from({ length: 8 }, () => pacer.book(1000, 0));

    expect(waits).toEqual([0, 125, 250, 375, 500, 625, 750, 875]);
  });

  it('does not take a clock that steps back for time still to wait', () => {
    const pacer = new Pacer(1000);
    pacer.book(1000, 60_000);

    // A minute earlier than the last time it was asked: the wait is what was booked, no more.
    expect(pacer.book(1000, 0)).toBe(1000);
    expect(pacer.book(1, 500)).toBe(1500);
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

  it('gives no credit for what is given back when nothing is owed', () => {
    const pacer = new Pacer(1000);

    pacer.book(-60_000, 0);

    expect(pacer.book(1000, 0)).toBe(0);
    expect(pacer.book(1, 0)).toBe(1000);
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
