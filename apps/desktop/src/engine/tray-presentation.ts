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

export function trayTooltip(activity: DownloadActivity | undefined): string {
  const parts = [
    ...(activity !== undefined && activity.downloading > 0
      ? [`${String(activity.downloading)} downloading`]
      : []),
    ...(activity !== undefined && activity.queued > 0 ? [`${String(activity.queued)} queued`] : []),
  ];
  return parts.length === 0 ? APP_NAME : `${APP_NAME} — ${parts.join(', ')}`;
}

// Said once, the first time the window goes away while Scia stays: a window that vanishes with
// no word looks like a crash, and a download that goes on unseen looks like a leak.
export const HIDDEN_TO_TRAY_NOTICE = {
  id: 'hidden-to-tray',
  title: 'Scia keeps downloading',
  body: 'It is in the system tray. Right-click its icon to quit.',
} as const;
