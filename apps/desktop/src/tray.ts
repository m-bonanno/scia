import { Menu, nativeImage, Tray } from 'electron';
import { TRAY_MENU, TrayCommand } from './engine/tray-presentation.ts';

export interface TrayLog {
  warn(message: string, details: object): void;
}

export interface SystemTrayOptions {
  readonly iconPath: string;
  readonly onOpen: () => void;
  readonly onQuit: () => void;
  // Read when the pointer reaches the icon, so the tooltip is true when it appears.
  readonly tooltip: () => Promise<string>;
  readonly log: TrayLog;
}

export interface SystemTray {
  setTooltip(text: string): void;
  destroy(): void;
}

// The icon in the system tray, or undefined when it cannot be made. That is not a way to know
// whether the desktop draws it: on a Linux desktop without a tray the object exists and shows
// nowhere, and Electron does not say (apps/desktop/CLAUDE.md, "The tray").
export function createSystemTray(options: SystemTrayOptions): SystemTray | undefined {
  try {
    const icon = nativeImage.createFromPath(options.iconPath);
    if (icon.isEmpty()) throw new Error(`No tray icon at ${options.iconPath}`);
    const tray = new Tray(icon);
    const run: Readonly<Record<TrayCommand, () => void>> = {
      [TrayCommand.Open]: options.onOpen,
      [TrayCommand.Quit]: options.onQuit,
    };
    const setTooltip = (text: string) => {
      if (!tray.isDestroyed()) tray.setToolTip(text);
    };
    tray.setToolTip('Scia');
    tray.setContextMenu(
      Menu.buildFromTemplate(
        TRAY_MENU.map((entry) =>
          entry === 'separator'
            ? { type: 'separator' as const }
            : { label: entry.label, click: run[entry.command] },
        ),
      ),
    );
    tray.on('click', options.onOpen);
    // Windows and macOS only: Linux never says the pointer arrived, and keeps the tooltip it
    // was last given.
    tray.on('mouse-enter', () => {
      void options.tooltip().then(setTooltip, () => undefined);
    });
    // The returned object keeps the tray alive: an unreferenced Tray is collected, and its icon
    // disappears a few minutes after the start.
    return {
      setTooltip,
      destroy: () => {
        if (!tray.isDestroyed()) tray.destroy();
      },
    };
  } catch (error) {
    options.log.warn('tray_unavailable', { error: String(error) });
    return undefined;
  }
}
