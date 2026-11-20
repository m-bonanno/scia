import { describe, expect, it } from 'vitest';
import { isInFront, isPutAway } from './window-state.ts';

describe('isInFront', () => {
  it('is in front only when it is shown, not minimised, and the one the person is using', () => {
    expect(isInFront({ visible: true, minimised: false, focused: true })).toBe(true);
  });

  it('is not when it is hidden in the tray, minimised, or behind another window', () => {
    expect(isInFront({ visible: false, minimised: false, focused: false })).toBe(false);
    expect(isInFront({ visible: true, minimised: true, focused: false })).toBe(false);
    expect(isInFront({ visible: true, minimised: false, focused: false })).toBe(false);
  });
});

describe('isPutAway', () => {
  it('is put away, for the tray to bring back, when it is not shown at all', () => {
    expect(isPutAway({ visible: false, minimised: false, focused: false })).toBe(true);
  });

  it('is not when it is minimised, which Windows also calls not visible: it is on the taskbar', () => {
    expect(isPutAway({ visible: false, minimised: true, focused: false })).toBe(false);
    expect(isPutAway({ visible: true, minimised: true, focused: false })).toBe(false);
  });

  it('is not while it is shown, in front or behind another window', () => {
    expect(isPutAway({ visible: true, minimised: false, focused: true })).toBe(false);
    expect(isPutAway({ visible: true, minimised: false, focused: false })).toBe(false);
  });
});
