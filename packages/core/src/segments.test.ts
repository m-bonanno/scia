import { describe, expect, it } from 'vitest';
import {
  compactSegments,
  downloadedBytes,
  isComplete,
  planSegments,
  remainingBytes,
  type Segment,
  splitLargest,
} from './segments.ts';

const MIB = 1024 * 1024;

function covers(segments: readonly Segment[], totalBytes: number): boolean {
  let expectedStart = 0;
  for (const segment of segments) {
    if (segment.start !== expectedStart || segment.end <= segment.start) return false;
    expectedStart = segment.end;
  }
  return expectedStart === totalBytes;
}

describe('planSegments', () => {
  it('gives each connection a contiguous range that together cover the file', () => {
    const segments = planSegments(100 * MIB + 3, 8, MIB);
    expect(segments).toHaveLength(8);
    expect(covers(segments, 100 * MIB + 3)).toBe(true);
  });

  it('uses fewer connections for a file too small to be worth splitting', () => {
    expect(planSegments(3 * MIB, 8, MIB)).toHaveLength(3);
    expect(planSegments(100, 8, MIB)).toEqual([{ start: 0, end: 100, downloaded: 0 }]);
  });

  it('never leaves an empty range when the size does not divide evenly', () => {
    const segments = planSegments(5, 4, 1);
    expect(covers(segments, 5)).toBe(true);
    expect(segments.map(remainingBytes)).toEqual([2, 1, 1, 1]);
  });

  it('plans nothing for an empty file and one range for a nonsensical connection count', () => {
    expect(planSegments(0, 8, MIB)).toEqual([]);
    expect(planSegments(10 * MIB, 0, MIB)).toHaveLength(1);
  });
});

describe('splitLargest', () => {
  it('hands over the second half of what the busiest range still has to fetch', () => {
    const segments: Segment[] = [
      { start: 0, end: 100, downloaded: 100 },
      { start: 100, end: 300, downloaded: 40 },
    ];
    expect(splitLargest(segments, 10)).toEqual({
      index: 1,
      shrunk: { start: 100, end: 220, downloaded: 40 },
      added: { start: 220, end: 300, downloaded: 0 },
    });
  });

  it('keeps every byte of the file in exactly one range', () => {
    const segments = planSegments(1000, 2, 1);
    const split = splitLargest(segments, 1);
    expect(split).toBeDefined();
    const after = segments
      .map((segment, index) => (index === split!.index ? split!.shrunk : segment))
      .concat(split!.added)
      .sort((a, b) => a.start - b.start);
    expect(covers(after, 1000)).toBe(true);
  });

  it('does not split a range too small to be worth a new connection', () => {
    expect(splitLargest([{ start: 0, end: 30, downloaded: 11 }], 10)).toBeUndefined();
    expect(splitLargest([], 10)).toBeUndefined();
  });
});

describe('compactSegments', () => {
  it('joins a finished range to the one after it, whatever order they come in', () => {
    const segments: Segment[] = [
      { start: 220, end: 300, downloaded: 10 },
      { start: 0, end: 100, downloaded: 100 },
      { start: 100, end: 220, downloaded: 120 },
    ];
    expect(compactSegments(segments)).toEqual([{ start: 0, end: 300, downloaded: 230 }]);
  });

  it('keeps apart the ranges with a gap still to fetch between them', () => {
    const segments: Segment[] = [
      { start: 0, end: 100, downloaded: 40 },
      { start: 100, end: 200, downloaded: 100 },
    ];
    expect(compactSegments(segments)).toEqual(segments);
  });
});

describe('progress of a set of segments', () => {
  it('sums what is on disk and knows when nothing is left', () => {
    const segments: Segment[] = [
      { start: 0, end: 10, downloaded: 10 },
      { start: 10, end: 20, downloaded: 4 },
    ];
    expect(downloadedBytes(segments)).toBe(14);
    expect(isComplete(segments)).toBe(false);
    expect(isComplete([{ start: 0, end: 10, downloaded: 10 }])).toBe(true);
    expect(isComplete([])).toBe(true);
  });
});
