import { splitExtension } from '@scia/core';
import { type Ended, Ending } from './ended-downloads.ts';

export interface EndedNotice {
  readonly title: string;
  readonly body: string;
}

export interface EndedNoticeContext {
  // Nothing is running or waiting any more, and the window was put away: Scia is idle in the
  // tray, and nothing else would say so.
  readonly lastOfHiddenScia: boolean;
}

// What the system shows under a notification's title before it cuts, from the end: the body
// is composed against it, so that what is said last is never what is lost.
const BODY_LINES = 4;
// A name longer than a line of the notification is cut, not wrapped onto the next.
const LINE_CHARS = 40;
// How much of a name is kept before its extension when it is cut: what tells two episodes
// apart is at the end.
const KEPT_STEM_END_CHARS = 10;
const FAILED_MARK = 'Failed: ';
// True after a failure, and with a paused download still in the list.
const NOTHING_ELSE = 'Nothing else is downloading.';
export const STILL_IN_TRAY = 'Scia is still in the system tray.';
const IDLE_LINES = [NOTHING_ELSE, STILL_IN_TRAY];

function counted(count: number, what: string): string {
  return `${String(count)} ${count === 1 ? 'download' : 'downloads'} ${what}`;
}

function titleOf(completed: number, failed: number): string {
  if (completed + failed === 1) return completed === 1 ? 'Download completed' : 'Download failed';
  if (failed === 0) return counted(completed, 'completed');
  if (completed === 0) return counted(failed, 'failed');
  return `${counted(completed, 'completed')}, ${String(failed)} failed`;
}

function onOneLine(name: string, room: number): string {
  if (name.length <= room) return name;
  const { stem, extension } = splitExtension(name);
  const end = `${stem.slice(-KEPT_STEM_END_CHARS)}${extension}`;
  return `${name.slice(0, room - end.length - 1)}…${end}`;
}

// What the system's notification says of the downloads that ended together. "Completed" is the
// word their rows use; why one failed is said on its row, where that text lives.
export function endedNotice(ended: readonly Ended[], context: EndedNoticeContext): EndedNotice {
  const failed = ended.filter((download) => download.ending === Ending.Failed);
  const completed = ended.filter((download) => download.ending === Ending.Completed);
  // Among downloads that completed, the ones that failed are what the person has to look at:
  // first, and marked, so that they are never among those only counted.
  const mixed = failed.length > 0 && completed.length > 0;
  const names = [
    ...failed.map((download) =>
      mixed
        ? `${FAILED_MARK}${onOneLine(download.fileName, LINE_CHARS - FAILED_MARK.length)}`
        : onOneLine(download.fileName, LINE_CHARS),
    ),
    ...completed.map((download) => onOneLine(download.fileName, LINE_CHARS)),
  ];
  const idle = context.lastOfHiddenScia ? IDLE_LINES : [];
  const room = BODY_LINES - idle.length;
  const named =
    names.length <= room
      ? names
      : [...names.slice(0, room - 1), `and ${String(names.length - (room - 1))} more`];
  return {
    title: titleOf(completed.length, failed.length),
    body: [...named, ...idle].join('\n'),
  };
}
