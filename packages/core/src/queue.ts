import { DownloadStatus } from './download.ts';

export interface QueueEntry {
  readonly id: string;
  readonly status: DownloadStatus;
}

// Which waiting downloads may start now, in the order of the queue.
export function nextToStart(queue: readonly QueueEntry[], maxConcurrent: number): string[] {
  const running = queue.filter((entry) => entry.status === DownloadStatus.Downloading).length;
  const free = Math.max(0, Math.floor(maxConcurrent) - running);
  return queue
    .filter((entry) => entry.status === DownloadStatus.Queued)
    .slice(0, free)
    .map((entry) => entry.id);
}
