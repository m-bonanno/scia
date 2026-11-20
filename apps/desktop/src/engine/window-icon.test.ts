import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { windowIconFile } from './window-icon.ts';

const assets = join(import.meta.dirname, '..', '..', 'assets');

describe('windowIconFile', () => {
  // Windows reads every size it needs from an .ico; Electron reads no .ico on Linux.
  it('is the .ico on Windows and a PNG elsewhere', () => {
    expect(windowIconFile('win32')).toBe('icon.ico');
    expect(windowIconFile('linux')).toBe('icon.png');
  });

  it('names a file that ships among the assets', () => {
    for (const platform of ['win32', 'linux'])
      expect(existsSync(join(assets, windowIconFile(platform)))).toBe(true);
  });
});
