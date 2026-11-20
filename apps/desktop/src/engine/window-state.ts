export interface WindowState {
  // Whether it was ever on screen: it is made hidden, and shows once it has a page.
  readonly shownOnce: boolean;
  readonly visible: boolean;
  readonly minimised: boolean;
  readonly focused: boolean;
}

// Whether the person is looking at Scia's window: shown, not minimised, and the one they are
// using. Hidden in the tray, minimised or behind another window, a row that changes is not seen.
export function isInFront(state: WindowState): boolean {
  return state.visible && !state.minimised && state.focused;
}

// Whether the window was put away, for the tray to bring back: shown once, and now neither
// shown nor minimised. A minimised window is still on the taskbar, and Windows calls that one
// "not visible" too; a window still loading its first page was put nowhere.
export function isPutAway(state: WindowState): boolean {
  return state.shownOnce && !state.visible && !state.minimised;
}
