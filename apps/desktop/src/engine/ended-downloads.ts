import type { Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';

export const Ending = { Completed: 'completed', Failed: 'failed' } as const;
export type Ending = (typeof Ending)[keyof typeof Ending];

// A download that has just ended, as a notification names it.
export interface Ended {
  readonly id: string;
  readonly fileName: string;
  readonly ending: Ending;
}

function endingOf(status: DownloadStatus): Ending | undefined {
  if (status === DownloadStatus.Completed) return Ending.Completed;
  if (status === DownloadStatus.Failed) return Ending.Failed;
  return undefined;
}

// Follows the engine's list from one look to the next and names what ended in between. What
// had already ended at the first look is old news: only what ends while Scia runs is said. It
// is kept across an engine that restarts, whose list is the same downloads.
export class EndedDownloads {
  #statuses: ReadonlyMap<string, DownloadStatus> | undefined;

  seen(downloads: readonly Download[]): Ended[] {
    const before = this.#statuses;
    this.#statuses = new Map(downloads.map((download) => [download.id, download.status]));
    if (before === undefined) return [];
    return downloads.flatMap((download) => {
      const ending = endingOf(download.status);
      // A pause, a removal and a wait in the queue are the person's doing, or no end at all.
      return ending === undefined || before.get(download.id) === download.status
        ? []
        : [{ id: download.id, fileName: download.fileName, ending }];
    });
  }
}
