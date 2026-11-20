import { describe, expect, it } from 'vitest';
import { EndedBatch } from './ended-batch.ts';
import { type Ended, Ending } from './ended-downloads.ts';

const completed = (id: string): Ended => ({ id, fileName: `${id}.bin`, ending: Ending.Completed });
const failed = (id: string): Ended => ({ id, fileName: `${id}.bin`, ending: Ending.Failed });

// A timer the spec fires by hand: what was asked to run, after how long, and whether it was
// called off.
function aTimer() {
  const waits: { ms: number; run: () => void; calledOff: boolean }[] = [];
  return {
    waits,
    wait: (ms: number, run: () => void) => {
      const entry = { ms, run, calledOff: false };
      waits.push(entry);
      return () => {
        entry.calledOff = true;
      };
    },
  };
}

describe('EndedBatch', () => {
  it('hands over a download that ended alone, after the wait that lets others join it', () => {
    const timer = aTimer();
    const delivered: (readonly Ended[])[] = [];
    const batch = new EndedBatch({
      ...timer,
      gatherMs: 2000,
      deliver: (ended) => delivered.push(ended),
    });

    batch.add([completed('a')]);
    expect(delivered).toEqual([]);
    expect(timer.waits.map((wait) => wait.ms)).toEqual([2000]);

    timer.waits[0]!.run();
    expect(delivered).toEqual([[completed('a')]]);
  });

  it('hands over together the downloads that end within the same wait, in the order they ended', () => {
    const timer = aTimer();
    const delivered: (readonly Ended[])[] = [];
    const batch = new EndedBatch({
      ...timer,
      gatherMs: 2000,
      deliver: (ended) => delivered.push(ended),
    });

    batch.add([completed('a')]);
    batch.add([failed('b'), completed('c')]);
    // One wait, counted from the first: a download does not wait for ever on those after it.
    expect(timer.waits).toHaveLength(1);
    timer.waits[0]!.run();

    expect(delivered).toEqual([[completed('a'), failed('b'), completed('c')]]);
  });

  it('starts over for what ends after a handover', () => {
    const timer = aTimer();
    const delivered: (readonly Ended[])[] = [];
    const batch = new EndedBatch({
      ...timer,
      gatherMs: 2000,
      deliver: (ended) => delivered.push(ended),
    });
    batch.add([completed('a')]);
    timer.waits[0]!.run();

    batch.add([completed('b')]);
    timer.waits[1]!.run();

    expect(delivered).toEqual([[completed('a')], [completed('b')]]);
  });

  it('keeps the last end of a download that ended twice within the wait', () => {
    const timer = aTimer();
    const delivered: (readonly Ended[])[] = [];
    const batch = new EndedBatch({
      ...timer,
      gatherMs: 2000,
      deliver: (ended) => delivered.push(ended),
    });

    batch.add([failed('a')]);
    batch.add([completed('a')]);
    timer.waits[0]!.run();

    expect(delivered).toEqual([[completed('a')]]);
  });

  it('says a download that ended twice where it ended last, after those that ended meanwhile', () => {
    const timer = aTimer();
    const delivered: (readonly Ended[])[] = [];
    const batch = new EndedBatch({
      ...timer,
      gatherMs: 2000,
      deliver: (ended) => delivered.push(ended),
    });

    batch.add([failed('a')]);
    batch.add([completed('b')]);
    batch.add([completed('a')]);
    timer.waits[0]!.run();

    expect(delivered).toEqual([[completed('b'), completed('a')]]);
  });

  it('waits for nothing when nothing ended', () => {
    const timer = aTimer();
    const batch = new EndedBatch({ ...timer, gatherMs: 2000, deliver: () => undefined });

    batch.add([]);

    expect(timer.waits).toEqual([]);
  });

  it('hands nothing over once it is stopped, and calls its wait off', () => {
    const timer = aTimer();
    const delivered: (readonly Ended[])[] = [];
    const batch = new EndedBatch({
      ...timer,
      gatherMs: 2000,
      deliver: (ended) => delivered.push(ended),
    });
    batch.add([completed('a')]);

    batch.stop();
    batch.add([completed('b')]);

    expect(timer.waits.map((wait) => wait.calledOff)).toEqual([true]);
    expect(delivered).toEqual([]);
  });
});
