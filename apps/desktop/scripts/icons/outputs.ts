import { join } from 'node:path';

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

// The one source of every icon of the app: the approved mark on its tile (#81).
export const ICON_SOURCE = 'assets/icon.svg';
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
