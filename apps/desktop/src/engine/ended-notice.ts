import { LOCALE } from '@scia/contracts/locale';
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

// What the system shows under a notification's title: Microsoft's documentation gives "up to
// 4 lines (combined)" for the kind of notification Electron asks for. The body is composed
// within them, so that nothing it has to say depends on where the system cuts — which, like
// the number itself, nobody has seen (#13).
const BODY_LINES = 4;
// A name longer than this is cut, not left to wrap onto the next line. Forty characters are
// a line for narrow letters; wide ones, and a larger text size, take more (#13).
const LINE_CHARS = 40;
// How much of a name is kept before its extension when it is cut. For an episode or a part
// that is what tells it from the next; for a name that ends in its codec it is not (#13).
const KEPT_STEM_END_CHARS = 10;
// A character as a person sees it: an emoji, a flag, a letter with its accent. A cut counted
// in the units of the text would leave half of one. The contract's locale, not the machine's:
// the same name is cut the same way everywhere.
const graphemes = new Intl.Segmenter(LOCALE, { granularity: 'grapheme' });
const charactersOf = (text: string) => Array.from(graphemes.segment(text), (part) => part.segment);
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
  const whole = charactersOf(name);
  if (whole.length <= room) return name;
  const { stem, extension } = splitExtension(name);
  const end = [...charactersOf(stem).slice(-KEPT_STEM_END_CHARS), ...charactersOf(extension)];
  return [...whole.slice(0, room - end.length - 1), '…', ...end].join('');
}

// What the system's notification says of the downloads that ended together. "Completed" is the
// word their rows use; why one failed is said on its row, where that text lives.
export function endedNotice(ended: readonly Ended[], context: EndedNoticeContext): EndedNotice {
  const failed = ended.filter((download) => download.ending === Ending.Failed);
  const completed = ended.filter((download) => download.ending === Ending.Completed);
  // Among downloads that completed, the ones that failed are what the person has to look at:
  // first, and marked, so that one that failed is never passed over for one that completed.
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
