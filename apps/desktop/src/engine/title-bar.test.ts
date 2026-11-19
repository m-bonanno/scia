import { WINDOW_COLOURS } from '@scia/contracts/theme';
import { describe, expect, it } from 'vitest';
import { titleBarOverlay, windowFrameOptions } from './title-bar.ts';

describe('the window frame', () => {
  it('lets the page draw the title bar on Windows and Linux', () => {
    const overlay = titleBarOverlay('dark', true);
    expect(windowFrameOptions('win32', overlay)).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: overlay,
    });
    expect(windowFrameOptions('linux', overlay).titleBarStyle).toBe('hidden');
  });

  it('keeps the system frame elsewhere', () => {
    expect(windowFrameOptions('darwin', titleBarOverlay('dark', true))).toEqual({});
  });

  it('paints the system buttons in the theme, dimmed with the window', () => {
    expect(titleBarOverlay('light', true)).toEqual({
      color: WINDOW_COLOURS.light.background,
      symbolColor: WINDOW_COLOURS.light.foreground,
      height: 40,
    });
    expect(titleBarOverlay('dark', false).symbolColor).toBe(WINDOW_COLOURS.dark.inactiveForeground);
  });
});
