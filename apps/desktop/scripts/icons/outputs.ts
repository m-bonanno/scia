import { join } from 'node:path';
import { WINDOW_COLOURS } from '@scia/contracts/theme';

export interface IconOutput {
  // Relative to apps/desktop.
  readonly path: string;
  readonly format: 'ico' | 'png';
  readonly sizes: readonly number[];
}

// What `npm run icons` wrote: the hashes of the source and of every output.
export interface IconLock {
  readonly source: string;
  readonly outputs: Readonly<Record<string, string>>;
}

export const DESKTOP_DIR = join(import.meta.dirname, '..', '..');

// The drawing every icon of the app is drawn from: the mark of `@scia/contracts/mark`, which the
// page's logo draws too (#88), on its tile, written by the script before it draws.
export const ICON_SOURCE = 'assets/icon.svg';
// The owner's choice (#81): the default theme's dark variant, the colours the window wears.
export const ICON_COLOURS = WINDOW_COLOURS['black-tie'].dark;
export const ICON_LOCK = 'scripts/icons/icons.lock.json';

const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

export const ICON_OUTPUTS: readonly IconOutput[] = [
  { path: 'assets/icon.ico', format: 'ico', sizes: [16, 24, 32, 48, 64, 128, 256] },
  { path: 'assets/icon.png', format: 'png', sizes: [256] },
  { path: 'assets/tray.png', format: 'png', sizes: [16] },
  { path: 'assets/tray@1.5x.png', format: 'png', sizes: [24] },
  { path: 'assets/tray@2x.png', format: 'png', sizes: [32] },
  ...LINUX_SIZES.map((size): IconOutput => ({
    path: `build/icons/${String(size)}x${String(size)}.png`,
    format: 'png',
    sizes: [size],
  })),
];

export function sizesToDraw(outputs: readonly IconOutput[]): number[] {
  return [...new Set(outputs.flatMap((output) => output.sizes))].sort((a, b) => a - b);
}
