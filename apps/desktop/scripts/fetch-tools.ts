// The programs Scia ships beside its engine, fetched at build time at the version fixed here and
// refused unless their bytes match the checksum their project published (docs/adr/0009).
// Run by itself for this computer (`npm start`), and by electron-builder before it packs, for the
// system it packs for (`beforePack` in electron-builder.yml).
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { YT_DLP_OF_PLATFORM, YT_DLP_VERSION } from '../src/engine/runtime-layout.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function held(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

export async function fetchTools(platform: NodeJS.Platform): Promise<string> {
  const build = YT_DLP_OF_PLATFORM[platform];
  if (build === undefined) {
    throw new Error(`No build of yt-dlp is fixed for ${platform}.`);
  }
  const target = join(ROOT, 'tools', build.os, build.file);
  const kept = await held(target);
  if (kept !== undefined && sha256(kept) === build.sha256) return target;

  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${build.asset}`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const got = sha256(bytes);
  if (got !== build.sha256) {
    throw new Error(`${build.asset} ${YT_DLP_VERSION} is not the build that was fixed: ${got}.`);
  }
  await mkdir(dirname(target), { recursive: true });
  const partial = `${target}.part`;
  await writeFile(partial, bytes);
  if (platform !== 'win32') await chmod(partial, 0o755);
  await rm(target, { force: true });
  await rename(partial, target);
  console.warn(`yt-dlp ${YT_DLP_VERSION} for ${build.os}: ${target}`);
  return target;
}

// electron-builder's hook: the system being packed, which need not be this one. A pack never
// goes on without its tools.
export default async function beforePack(context: {
  readonly electronPlatformName: string;
}): Promise<void> {
  await fetchTools(context.electronPlatformName as NodeJS.Platform);
}

// `npm start` on this computer: a run with no network goes on, with pages fetched as they stand.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (YT_DLP_OF_PLATFORM[process.platform] === undefined) {
    console.warn(`No build of yt-dlp for ${process.platform}: pages are fetched as they stand.`);
  } else {
    await fetchTools(process.platform).catch((error: unknown) => {
      console.warn(`yt-dlp not fetched, pages are fetched as they stand: ${String(error)}`);
    });
  }
}
