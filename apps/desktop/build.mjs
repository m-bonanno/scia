// Only `electron` stays external: the packaged asar carries no node_modules.
import { access, cp } from 'node:fs/promises';
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.cts'], outfile: 'dist/preload.cjs' });

// A zero exit code is not proof: without its icon the tray is silently absent. The source is
// checked, not the copy, which can survive from an earlier build.
await access('assets/tray.png');
// What main loads by path sits beside main.cjs, so the asar carries it.
await cp('assets', 'dist/assets', { recursive: true });
