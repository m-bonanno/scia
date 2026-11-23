import type { Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';

export const Filter = { All: 'all', Active: 'active', Completed: 'completed' } as const;
export type Filter = (typeof Filter)[keyof typeof Filter];

export const FILTER_LABELS: Readonly<Record<Filter, string>> = {
  all: 'All',
  active: 'In progress',
  completed: 'Completed',
};

// "In progress" is everything not finished: a paused or failed download still asks for attention.
export function matchesFilter(filter: Filter, status: DownloadStatus): boolean {
  if (filter === Filter.All) return true;
  const completed = status === DownloadStatus.Completed;
  return filter === Filter.Completed ? completed : !completed;
}

// What waits on the service or on a choice — a magnet (#137), a link that opens into several files
// (#181) — is in the list and not finished, whatever the service does with it.
export function countByFilter(downloads: readonly Download[], waiting = 0): Record<Filter, number> {
  const completed = downloads.filter((d) => d.status === DownloadStatus.Completed).length;
  return {
    all: downloads.length + waiting,
    active: downloads.length - completed + waiting,
    completed,
  };
}
