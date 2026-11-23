import type { Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

const FILL: Readonly<Record<DownloadStatus, string>> = {
  ready: 'bg-muted-foreground',
  downloading: 'bg-accent',
  queued: 'bg-muted-foreground',
  paused: 'bg-paused',
  failed: 'bg-destructive',
  completed: 'bg-accent',
};

// The file as a line, each connection filling its own stretch of it where that stretch is: the
// picture of what "eight connections" means.
export function SegmentBar({ download }: { readonly download: Download }): ReactNode {
  // A stream is measured in time: its pieces on the line of how long it lasts.
  const measure =
    download.timeline === null
      ? { total: download.totalBytes, segments: download.segments, done: download.downloadedBytes }
      : {
          total: download.timeline.totalMs,
          segments: download.timeline.segments,
          done: download.timeline.segments.reduce((sum, piece) => sum + piece.downloaded, 0),
        };
  const { total } = measure;
  const fill = FILL[download.status];

  if (total === null || total === 0) {
    // A size nobody announced: movement without a measure.
    return (
      <div
        className="h-1 overflow-hidden rounded-full bg-tonal"
        role="progressbar"
        aria-label="Progress"
      >
        {download.status === DownloadStatus.Downloading && (
          <div className={cn('h-full w-1/4 animate-indeterminate rounded-full', fill)} />
        )}
      </div>
    );
  }

  return (
    <div
      className="relative h-1 overflow-hidden rounded-full bg-tonal"
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor((measure.done / total) * 100)}
    >
      {measure.segments.map((segment, index) => (
        <div
          // Two pieces of no length start at the same moment.
          key={index}
          className={cn('absolute inset-y-0 transition-[width] duration-300 ease-linear', fill)}
          style={{
            left: `${String((segment.start / total) * 100)}%`,
            width: `${String((segment.downloaded / total) * 100)}%`,
          }}
        />
      ))}
    </div>
  );
}
