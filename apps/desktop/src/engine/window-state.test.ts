import { describe, expect, it } from 'vitest';
import { isInFront, isPutAway, type WindowState } from './window-state.ts';

const shown: WindowState = { shownOnce: true, visible: true, minimised: false, focused: true };

describe('isInFront', () => {
  it('is in front only when it is shown, not minimised, and the one the person is using', () => {
    expect(isInFront(shown)).toBe(true);
  });

  it('is not when it is hidden in the tray, minimised, or behind another window', () => {
    expect(isInFront({ ...shown, visible: false, focused: false })).toBe(false);
    expect(isInFront({ ...shown, minimised: true, focused: false })).toBe(false);
    expect(isInFront({ ...shown, focused: false })).toBe(false);
  });

  it('is not for the focus alone: a window not shown, or minimised, is not looked at', () => {
    expect(isInFront({ ...shown, visible: false })).toBe(false);
    expect(isInFront({ ...shown, minimised: true })).toBe(false);
  });
});

describe('isPutAway', () => {
  it('is put away, for the tray to bring back, when it was shown and is not shown at all now', () => {
    expect(isPutAway({ ...shown, visible: false, focused: false })).toBe(true);
  });

  it('is not when it is minimised, which Windows also calls not visible: it is on the taskbar', () => {
    expect(isPutAway({ ...shown, visible: false, minimised: true, focused: false })).toBe(false);
    expect(isPutAway({ ...shown, minimised: true, focused: false })).toBe(false);
  });

  it('is not while it is shown, in front or behind another window', () => {
    expect(isPutAway(shown)).toBe(false);
    expect(isPutAway({ ...shown, focused: false })).toBe(false);
  });

  it('is not before it was ever shown: a window still loading its first page was put nowhere', () => {
    expect(isPutAway({ shownOnce: false, visible: false, minimised: false, focused: false })).toBe(
      false,
    );
  });
});
