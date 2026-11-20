import { type Ended, Ending } from './ended-downloads.ts';

export interface EndedNotice {
  readonly title: string;
  readonly body: string;
}

export interface EndedNoticeContext {
  // Nothing is running or waiting any more, and the window is hidden: Scia is idle in the tray,
  // and nothing else would say so.
  readonly lastOfHiddenScia: boolean;
}

// More names than this are counted, not listed: a playlist ends as one line, not as a wall.
const NAMED = 3;

function counted(count: number, what: string): string {
  return `${String(count)} ${count === 1 ? 'download' : 'downloads'} ${what}`;
}

function titleOf(completed: number, failed: number): string {
  if (completed + failed === 1) return completed === 1 ? 'Download completed' : 'Download failed';
  if (failed === 0) return counted(completed, 'completed');
  if (completed === 0) return counted(failed, 'failed');
  return `${counted(completed, 'completed')}, ${String(failed)} failed`;
}

// What the system's notification says of the downloads that ended together. "Completed" is the
// word their rows use; why one failed is said on its row, where that text lives.
export function endedNotice(ended: readonly Ended[], context: EndedNoticeContext): EndedNotice {
  const completed = ended.filter((download) => download.ending === Ending.Completed).length;
  const names = ended.slice(0, NAMED).map((download) => download.fileName);
  const lines = [
    ...names,
    ...(ended.length > NAMED ? [`and ${String(ended.length - NAMED)} more`] : []),
    ...(context.lastOfHiddenScia
      ? ['Nothing left to download. Scia is still in the system tray.']
      : []),
  ];
  return { title: titleOf(completed, ended.length - completed), body: lines.join('\n') };
}
