import { describe, expect, it } from 'vitest';
import { CloseAction, closeAction } from './close-policy.ts';

describe('closeAction', () => {
  it('hides the window while something is downloading or waiting, and a tray can bring it back', () => {
    expect(closeAction({ trayAvailable: true, unfinished: 2 })).toBe(CloseAction.Hide);
  });

  it('quits when nothing is left to download', () => {
    expect(closeAction({ trayAvailable: true, unfinished: 0 })).toBe(CloseAction.Quit);
  });

  it('quits where there is no tray to come back from', () => {
    expect(closeAction({ trayAvailable: false, unfinished: 5 })).toBe(CloseAction.Quit);
  });

  it('quits when the engine did not say what it is doing', () => {
    expect(closeAction({ trayAvailable: true, unfinished: undefined })).toBe(CloseAction.Quit);
  });
});
