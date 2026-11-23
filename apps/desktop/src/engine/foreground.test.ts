import { describe, expect, it } from 'vitest';
import { foregroundCommand, handleFromLine, windowInUse } from './foreground.ts';

describe('foregroundCommand', () => {
  it("runs the system's own PowerShell, with nothing of main's environment but SystemRoot", () => {
    const command = foregroundCommand('C:\\Windows');

    expect(command.file).toBe(
      ['C:', 'Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'].join('\\'),
    );
    expect(command.env).toEqual({ SystemRoot: 'C:\\Windows' });
    expect(command.args.slice(0, 2)).toEqual(['-NoProfile', '-NonInteractive']);
    expect(command.args.at(-1)).toContain('GetForegroundWindow');
  });
});

describe('handleFromLine', () => {
  it('reads a handle, a whole number', () => {
    expect(handleFromLine('1312034\r')).toBe(1312034n);
  });

  it('reads nothing else as a handle', () => {
    for (const line of ['', 'ready', '-1', '12a', 'Exception']) {
      expect(handleFromLine(line), line).toBeUndefined();
    }
  });
});

describe('windowInUse (#62, ADR 0020)', () => {
  it('is in use when the system names its handle, and not when it names another', () => {
    expect(windowInUse(42n, 42n)).toBe(true);
    expect(windowInUse(7n, 42n)).toBe(false);
  });

  it('counts a system that did not answer as another window in use: a notification too many over one that never comes', () => {
    expect(windowInUse(undefined, 42n)).toBe(false);
  });
});
