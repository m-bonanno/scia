// The programs Scia ships beside its engine, fetched at build time at the version fixed here and
// refused unless their bytes match the checksum their project published (docs/adr/0009).
// Run by itself for this computer (`npm start`), and by electron-builder before it packs, for the
// system it packs for (`beforePack` in electron-builder.yml).
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// yt-dlp 2026.10.26: the checksums are its release's SHA2-256SUMS. `file` is the name the engine
// runs, under tools/<os>/ here and tools/ in the installed app (src/engine/runtime-layout.ts).
const YT_DLP_VERSION = '2026.10.26';
export const TOOLS = {
  win: {
    asset: 'yt-dlp.exe',
    file: 'yt-dlp.exe',
    sha256: 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d',
  },
  linux: {
    asset: 'yt-dlp_linux',
    file: 'yt-dlp',
    sha256: '767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795',
  },
};

// electron-builder's names of systems, which `${os}` in electron-builder.yml also gives.
const OS_OF_PLATFORM = { win32: 'win', linux: 'linux' };

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function held(path) {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

export async function fetchTools(os) {
  const tool = TOOLS[os];
  if (tool === undefined) throw new Error(`No build of yt-dlp is fixed for ${os}.`);
  const target = join(ROOT, 'tools', os, tool.file);
  const kept = await held(target);
  if (kept !== undefined && sha256(kept) === tool.sha256) return target;

  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${tool.asset}`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const got = sha256(bytes);
  if (got !== tool.sha256) {
    throw new Error(`${tool.asset} ${YT_DLP_VERSION} is not the build that was fixed: ${got}.`);
  }
  await mkdir(dirname(target), { recursive: true });
  const partial = `${target}.part`;
  await writeFile(partial, bytes);
  if (os !== 'win') await chmod(partial, 0o755);
  await rm(target, { force: true });
  await rename(partial, target);
  console.log(`yt-dlp ${YT_DLP_VERSION} for ${os}: ${target}`);
  return target;
}

// electron-builder's hook: the system being packed, which need not be this one.
export default async function beforePack(context) {
  const os = OS_OF_PLATFORM[context.electronPlatformName];
  if (os === undefined) throw new Error(`Scia does not pack for ${context.electronPlatformName}.`);
  await fetchTools(os);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const os = OS_OF_PLATFORM[process.platform];
  if (os === undefined) {
    console.log(`No build of yt-dlp for ${process.platform}: pages are fetched as they stand.`);
  } else {
    await fetchTools(os);
  }
}
