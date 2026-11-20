import { describe, expect, it } from 'vitest';
import { ICON_OUTPUTS, sizesToDraw } from './outputs.ts';

const sizesOf = (path: string): readonly number[] | undefined =>
  ICON_OUTPUTS.find((output) => output.path === path)?.sizes;

describe('the icons drawn from the source', () => {
  it('gives the installer, the exe, its shortcuts and the taskbar every size Windows asks for', () => {
    expect(sizesOf('assets/icon.ico')).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });

  // Electron takes tray@1.5x.png and tray@2x.png beside tray.png for screens scaled 150 and 200 %.
  it('gives the tray its three densities', () => {
    expect(sizesOf('assets/tray.png')).toEqual([16]);
    expect(sizesOf('assets/tray@1.5x.png')).toEqual([24]);
    expect(sizesOf('assets/tray@2x.png')).toEqual([32]);
  });

  it('gives the window on Linux a PNG beside the exe’s icon', () => {
    expect(sizesOf('assets/icon.png')).toEqual([256]);
  });

  // electron-builder reads a folder of <n>x<n>.png for the AppImage and the .deb.
  it('gives Linux packaging a PNG for every size, named as electron-builder reads them', () => {
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512])
      expect(sizesOf(`build/icons/${String(size)}x${String(size)}.png`)).toEqual([size]);
  });

  it('draws each size once, smallest first', () => {
    expect(sizesToDraw(ICON_OUTPUTS)).toEqual([16, 24, 32, 48, 64, 128, 256, 512]);
  });
});
