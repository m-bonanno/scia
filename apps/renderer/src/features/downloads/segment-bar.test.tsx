import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aDownload } from '@/test/a-download.ts';
import { SegmentBar } from './segment-bar.tsx';

describe('SegmentBar', () => {
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
