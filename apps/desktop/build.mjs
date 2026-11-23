// `electron` and `koffi` stay external: koffi loads its native build from beside its own files
// (ADR 0020), the one module the packaged app carries.
import { access, cp } from 'node:fs/promises';
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron', 'koffi'],
  sourcemap: true,
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.cts'], outfile: 'dist/preload.cjs' });

// A zero exit code is not proof: without its icon the tray is silently absent, and the window
// wears Electron's. The source is checked, not the copy, which can survive from an earlier build.
for (const icon of ['tray.png', 'icon.ico', 'icon.png']) await access(`assets/${icon}`);
// What main loads by path sits beside main.cjs, so the asar carries it.
await cp('assets', 'dist/assets', { recursive: true });
