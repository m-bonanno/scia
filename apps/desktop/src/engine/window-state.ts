export interface WindowState {
  readonly visible: boolean;
  readonly minimised: boolean;
  readonly focused: boolean;
}

// Whether the person is looking at Scia's window: shown, not minimised, and the one they are
// using. Hidden in the tray, minimised or behind another window, a row that changes is not seen.
export function isInFront(state: WindowState): boolean {
  return state.visible && !state.minimised && state.focused;
}

// Whether the window was put away, for the tray to bring back: not shown and not minimised. A
// minimised window is still on the taskbar, and Windows calls that one "not visible" too.
export function isPutAway(state: WindowState): boolean {
  return !state.visible && !state.minimised;
}
