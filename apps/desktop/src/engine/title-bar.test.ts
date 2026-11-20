import { WINDOW_COLOURS } from '@scia/contracts/theme';
import { describe, expect, it } from 'vitest';
import { titleBarOverlay, windowFrameOptions } from './title-bar.ts';

describe('the window frame', () => {
  it('lets the page draw the title bar on Windows and Linux', () => {
    const overlay = titleBarOverlay('black-tie', 'dark', true);
    expect(windowFrameOptions('win32', overlay)).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: overlay,
    });
    expect(windowFrameOptions('linux', overlay).titleBarStyle).toBe('hidden');
  });

  it('keeps the system frame elsewhere', () => {
    expect(windowFrameOptions('darwin', titleBarOverlay('black-tie', 'dark', true))).toEqual({});
  });

  it('paints the system buttons in the theme and its variant, dimmed with the window', () => {
    expect(titleBarOverlay('black-tie', 'light', true)).toEqual({
      color: WINDOW_COLOURS['black-tie'].light.background,
      symbolColor: WINDOW_COLOURS['black-tie'].light.foreground,
      height: 40,
    });
    expect(titleBarOverlay('ice', 'dark', true).color).toBe(WINDOW_COLOURS.ice.dark.background);
    expect(titleBarOverlay('ice', 'dark', false).symbolColor).toBe(
      WINDOW_COLOURS.ice.dark.inactiveForeground,
    );
  });
});
