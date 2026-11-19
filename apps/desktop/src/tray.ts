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
  destroy(): void;
}

// The icon in the system tray, or undefined where the desktop gives no tray: the caller then
// keeps today's behaviour, and closing the window quits.
export function createSystemTray(options: SystemTrayOptions): SystemTray | undefined {
  try {
    const icon = nativeImage.createFromPath(options.iconPath);
    if (icon.isEmpty()) throw new Error(`No tray icon at ${options.iconPath}`);
    const tray = new Tray(icon);
    const run: Readonly<Record<TrayCommand, () => void>> = {
      [TrayCommand.Open]: options.onOpen,
      [TrayCommand.Quit]: options.onQuit,
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
    tray.on('mouse-enter', () => {
      void options.tooltip().then(
        (text) => {
          if (!tray.isDestroyed()) tray.setToolTip(text);
        },
        () => undefined,
      );
    });
    // The returned object keeps the tray alive: an unreferenced Tray is collected, and its icon
    // disappears a few minutes after the start.
    return {
      destroy: () => {
        if (!tray.isDestroyed()) tray.destroy();
      },
    };
  } catch (error) {
    options.log.warn('tray_unavailable', { error: String(error) });
    return undefined;
  }
}
