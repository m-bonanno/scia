import type { Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { aDownload } from '@/test/a-download.ts';
import { SegmentBar } from './segment-bar.tsx';

type Span = readonly [from: number, to: number];

interface Stretch {
  readonly left: number;
  readonly width: number;
}

const aFile = (totalBytes: number, segments: Download['segments']) =>
  aDownload({
    totalBytes,
    segments,
    downloadedBytes: segments.reduce((sum, segment) => sum + segment.downloaded, 0),
  });

// Each stretch the bar draws, by its node: where it starts and how wide it is, in percent.
function stretchesOf(container: HTMLElement): Map<HTMLElement, Stretch> {
  return new Map(
    [...container.querySelectorAll<HTMLElement>('[role="progressbar"] > div')].map((node) => [
      node,
      { left: Number.parseFloat(node.style.left), width: Number.parseFloat(node.style.width) },
    ]),
  );
}

const spanOf = ({ left, width }: Stretch): Span => [left, left + width];

// What a set of stretches fills of the track, spans that touch joined into one.
function filled(spans: Iterable<Span>): Span[] {
  const joined: [number, number][] = [];
  const sorted = [...spans].filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  for (const [from, to] of sorted) {
    const last = joined.at(-1);
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else joined.push([from, to]);
  }
  return joined;
}

// The spans of one filling that the other does not fill.
const missingFrom = (outer: readonly Span[], inner: readonly Span[]) =>
  inner.filter(([from, to]) => !outer.some(([start, end]) => start <= from && to <= end));

describe('SegmentBar', () => {
  // A stretch's width moves over 300 ms, its place does not: a stretch the bar keeps from one list
  // to the next starts from the width it had, at its new place, and a stretch new to the bar is
  // drawn at once. The bar never goes back when what it draws at the first moment after a list
  // holds all it drew before, and nothing it will not draw at the end (#316).
  it.each<[string, number, Download['segments'], Download['segments']]>([
    [
      'the connections end and their stretches become one',
      800,
      Array.from({ length: 8 }, (_, index) => ({
        start: index * 100,
        end: index * 100 + 100,
        downloaded: 99,
      })),
      [{ start: 0, end: 800, downloaded: 800 }],
    ],
    [
      'a finished stretch joins the one after it',
      300,
      [
        { start: 0, end: 100, downloaded: 90 },
        { start: 100, end: 200, downloaded: 40 },
        { start: 200, end: 300, downloaded: 10 },
      ],
      [
        { start: 0, end: 200, downloaded: 150 },
        { start: 200, end: 300, downloaded: 20 },
      ],
    ],
    [
      'a connection that finished takes half of the stretch with the most left',
      800,
      [
        { start: 0, end: 400, downloaded: 150 },
        { start: 400, end: 800, downloaded: 390 },
      ],
      [
        { start: 0, end: 275, downloaded: 150 },
        { start: 275, end: 400, downloaded: 0 },
        { start: 400, end: 800, downloaded: 390 },
      ],
    ],
  ])('never goes back when %s', (_, totalBytes, before, after) => {
    const { container, rerender } = render(<SegmentBar download={aFile(totalBytes, before)} />);
    const drawn = stretchesOf(container);

    rerender(<SegmentBar download={aFile(totalBytes, after)} />);

    const now = stretchesOf(container);
    const atFirst = filled(
      [...now].map(([node, { left, width }]) =>
        spanOf({ left, width: drawn.get(node)?.width ?? width }),
      ),
    );
    expect(missingFrom(atFirst, filled([...drawn.values()].map(spanOf)))).toEqual([]);
    expect(missingFrom(filled([...now.values()].map(spanOf)), atFirst)).toEqual([]);
  });

  // The 300 ms of a width are how a stretch is seen filling.
  it('moves a stretch that only grows to its new width, from the one it had', () => {
    const { container, rerender } = render(
      <SegmentBar
        download={aFile(200, [
          { start: 0, end: 100, downloaded: 40 },
          { start: 100, end: 200, downloaded: 10 },
        ])}
      />,
    );
    const [first, second] = stretchesOf(container).keys();

    rerender(
      <SegmentBar
        download={aFile(200, [
          { start: 0, end: 100, downloaded: 60 },
          { start: 100, end: 200, downloaded: 30 },
        ])}
      />,
    );

    expect([...stretchesOf(container)]).toEqual([
      [first, { left: 0, width: 30 }],
      [second, { left: 50, width: 15 }],
    ]);
  });

  // A piece of a stream can last no time, and two such pieces start at the same moment.
  it('draws no stretch for a piece of a stream that lasts no time', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => {
      error.mockRestore();
    });

    const { container } = render(
      <SegmentBar
        download={aDownload({
          totalBytes: null,
          timeline: {
            totalMs: 2000,
            segments: [
              { start: 0, end: 1000, downloaded: 1000 },
              { start: 1000, end: 1000, downloaded: 0 },
              { start: 1000, end: 1000, downloaded: 0 },
              { start: 1000, end: 2000, downloaded: 500 },
            ],
          },
        })}
      />,
    );

    expect([...stretchesOf(container).values()]).toEqual([
      { left: 0, width: 50 },
      { left: 50, width: 25 },
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  // A paused bar has a tone of its own, held against the accent by the contrast spec (#58).
  it.each([
    [DownloadStatus.Downloading, 'bg-accent'],
    [DownloadStatus.Paused, 'bg-paused'],
  ])('fills a %s download in its own tone', (status, tone) => {
    const { container } = render(
      <SegmentBar
        download={aDownload({
          status,
          totalBytes: 100,
          downloadedBytes: 40,
          segments: [{ start: 0, end: 100, downloaded: 40 }],
        })}
      />,
    );

    const [stretch] = container.querySelectorAll('[role="progressbar"] > div');
    expect(stretch).toHaveClass(tone);
  });

  it('draws a stream as its pieces on a line of time, how far it is said by them', () => {
    const { container } = render(
      <SegmentBar
        download={aDownload({
          totalBytes: null,
          timeline: {
            totalMs: 4000,
            segments: [
              { start: 0, end: 1000, downloaded: 1000 },
              { start: 1000, end: 3000, downloaded: 2000 },
              { start: 3000, end: 4000, downloaded: 0 },
            ],
          },
        })}
      />,
    );

    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute(
      'aria-valuenow',
      '75',
    );
    const pieces = [...container.querySelectorAll<HTMLElement>('[role="progressbar"] > div')];
    expect(pieces.map((piece) => [piece.style.left, piece.style.width])).toEqual([
      ['0%', '25%'],
      ['25%', '50%'],
      ['75%', '0%'],
    ]);
  });
});
