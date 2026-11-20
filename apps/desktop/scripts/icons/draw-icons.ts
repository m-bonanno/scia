// Draws every icon of the app from its one source: `npm run icons -w @scia/desktop`, then commit
// the source, the icons and the lock together. The icons are committed rather than drawn by the
// build because Chromium draws them, and a build that starts Electron needs a display on Linux.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodeIco } from './ico.ts';
import {
  DESKTOP_DIR,
  ICON_LOCK,
  ICON_OUTPUTS,
  ICON_SOURCE,
  type IconLock,
  sizesToDraw,
} from './outputs.ts';
import { encodePng, type Raster } from './png.ts';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function rasterise(svgPath: string, sizes: readonly number[]): Map<number, Raster> {
  const scratch = mkdtempSync(join(tmpdir(), 'scia-icons-'));
  try {
    // The electron package answers the path of its executable.
    const electron = createRequire(import.meta.url)('electron') as string;
    const run = spawnSync(
      electron,
      [
        join(import.meta.dirname, 'rasterise.mjs'),
        svgPath,
        scratch,
        ...sizes.map(String),
        `--user-data-dir=${join(scratch, 'profile')}`,
      ],
      { stdio: 'inherit' },
    );
    if (run.status !== 0) throw new Error(`Electron drew no icon (exit ${String(run.status)})`);
    return new Map(
      sizes.map((size) => [
        size,
        { size, rgba: new Uint8Array(readFileSync(join(scratch, `${String(size)}.rgba`))) },
      ]),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function onlyOne(images: readonly Raster[]): Raster {
  const [only] = images;
  if (!only || images.length > 1) throw new Error('A PNG holds one size');
  return only;
}

const source = join(DESKTOP_DIR, ICON_SOURCE);
const rasters = rasterise(source, sizesToDraw(ICON_OUTPUTS));
const outputs: Record<string, string> = {};

for (const output of ICON_OUTPUTS) {
  const images = output.sizes.map((size) => {
    const raster = rasters.get(size);
    if (!raster) throw new Error(`No drawing at ${String(size)} px`);
    return raster;
  });
  const bytes = output.format === 'ico' ? encodeIco(images) : encodePng(onlyOne(images));
  const path = join(DESKTOP_DIR, output.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  outputs[output.path] = sha256(bytes);
  process.stdout.write(
    `${output.path}  ${output.sizes.join(', ')} px  ${String(bytes.length)} bytes\n`,
  );
}

const lock: IconLock = { source: sha256(readFileSync(source)), outputs };
writeFileSync(join(DESKTOP_DIR, ICON_LOCK), `${JSON.stringify(lock, null, 2)}\n`);
