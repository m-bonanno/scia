import type { DownloadActivity } from './download-activity.ts';

export const TrayCommand = { Open: 'open', Quit: 'quit' } as const;
export type TrayCommand = (typeof TrayCommand)[keyof typeof TrayCommand];

export interface TrayMenuEntry {
  readonly command: TrayCommand;
  readonly label: string;
}

// Two things to do from the tray, the frequent one first.
export const TRAY_MENU: readonly (TrayMenuEntry | 'separator')[] = [
  { command: TrayCommand.Open, label: 'Open Scia' },
  'separator',
  { command: TrayCommand.Quit, label: 'Quit' },
];

const APP_NAME = 'Scia';
// The separator of a download's status line in the list: one way to string facts together.
const SEPARATOR = ' · ';

// The app's name, and what it is doing when that is known. Undefined, or nothing going on, is
// the plain name: a count that may be stale is worse than none.
export function trayTooltip(activity: DownloadActivity | undefined): string {
  return [
    APP_NAME,
    ...(activity !== undefined && activity.downloading > 0
      ? [`${String(activity.downloading)} downloading`]
      : []),
    ...(activity !== undefined && activity.queued > 0 ? [`${String(activity.queued)} queued`] : []),
  ].join(SEPARATOR);
}

// Said once, the first time the window goes away while Scia stays: a window that vanishes with
// no word looks like a crash, and a download that goes on unseen looks like a leak.
export const HIDDEN_TO_TRAY_NOTICE = {
  id: 'hidden-to-tray',
  title: 'Scia is still downloading',
  body: 'Click its icon in the system tray to open it, right-click to quit.',
} as const;
