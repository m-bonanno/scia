// The unpacked extension: one bundle per page of the manifest, beside the static files.
import { cp } from 'node:fs/promises';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/background.ts', 'src/popup.ts', 'src/options.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
});
await cp('static', 'dist', { recursive: true });
