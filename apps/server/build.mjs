// One self-contained CommonJS file: the packaged app ships no engine node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/entry.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: true,
  legalComments: 'linked',
  logLevel: 'info',
});
