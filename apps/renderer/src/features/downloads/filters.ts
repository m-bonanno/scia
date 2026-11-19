import type { Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';

export const Filter = { All: 'all', Active: 'active', Completed: 'completed' } as const;
export type Filter = (typeof Filter)[keyof typeof Filter];

export const FILTER_LABELS: Readonly<Record<Filter, string>> = {
  all: 'Tutti',
  active: 'In corso',
  completed: 'Completati',
};

// «In corso» is everything not finished: a paused or failed download still asks for attention.
export function matchesFilter(filter: Filter, status: DownloadStatus): boolean {
  if (filter === Filter.All) return true;
  const completed = status === DownloadStatus.Completed;
  return filter === Filter.Completed ? completed : !completed;
}

export function countByFilter(downloads: readonly Download[]): Record<Filter, number> {
  const completed = downloads.filter((d) => d.status === DownloadStatus.Completed).length;
  return { all: downloads.length, active: downloads.length - completed, completed };
}
