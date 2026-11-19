import { describe, expect, it } from 'vitest';
import { TRAY_MENU, TrayCommand, trayTooltip } from './tray-presentation.ts';

describe('trayTooltip', () => {
  it('is the app’s name when nothing is going on, or nothing is known', () => {
    expect(trayTooltip({ downloading: 0, queued: 0 })).toBe('Scia');
    expect(trayTooltip(undefined)).toBe('Scia');
  });

  it('says how many downloads run and how many wait', () => {
    expect(trayTooltip({ downloading: 2, queued: 1 })).toBe('Scia — 2 downloading, 1 queued');
    expect(trayTooltip({ downloading: 1, queued: 0 })).toBe('Scia — 1 downloading');
    expect(trayTooltip({ downloading: 0, queued: 3 })).toBe('Scia — 3 queued');
  });
});

describe('the tray menu', () => {
  it('opens the window first and quits last', () => {
    const commands = TRAY_MENU.filter((item) => item !== 'separator').map((item) => item.command);
    expect(commands).toEqual([TrayCommand.Open, TrayCommand.Quit]);
  });
});
