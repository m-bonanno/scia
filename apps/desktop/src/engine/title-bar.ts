import { type ResolvedTheme, WINDOW_COLOURS } from '@scia/contracts/theme';

// The window's own buttons are 46 × 40 on Windows: the bar the page draws is as high.
export const TITLE_BAR_HEIGHT = 40;

export interface TitleBarOverlay {
  readonly color: string;
  readonly symbolColor: string;
  readonly height: number;
}

// The page draws the title bar and the system keeps its own buttons, with Snap Layouts and the
// system keys. macOS would need its traffic lights placed: not a target yet, it keeps its frame.
export function hasIntegratedTitleBar(platform: string): boolean {
  return platform === 'win32' || platform === 'linux';
}

export function titleBarOverlay(theme: ResolvedTheme, focused: boolean): TitleBarOverlay {
  const colours = WINDOW_COLOURS[theme];
  return {
    color: colours.background,
    // The buttons dim with the window, as the system's own do.
    symbolColor: focused ? colours.foreground : colours.inactiveForeground,
    height: TITLE_BAR_HEIGHT,
  };
}

export function windowFrameOptions(
  platform: string,
  overlay: TitleBarOverlay,
): { titleBarStyle?: 'hidden'; titleBarOverlay?: TitleBarOverlay } {
  return hasIntegratedTitleBar(platform)
    ? { titleBarStyle: 'hidden', titleBarOverlay: overlay }
    : {};
}
