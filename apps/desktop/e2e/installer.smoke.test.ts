import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type RangeServer, startRangeServer } from '@scia/server/testing/range-server.ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { YT_DLP_VERSION } from '../scripts/fetch-tools.ts';
import { YT_DLP_OF_PLATFORM } from '../src/engine/runtime-layout.ts';
import {
  launchScia,
  paste,
  type Profile,
  rowOf,
  type Scia,
  scratchProfile,
  until,
} from './scia.ts';

const run = promisify(execFile);

// The installer under test, and the version it was built with (docs/development/release-flow.md).
const INSTALLER = process.env.SCIA_INSTALLER;
const VERSION = process.env.SCIA_VERSION;
// A one-click install for the person (electron-builder.yml, `nsis`): its own folder under
// Programs, named after the app (#79).
const INSTALL_DIR = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'scia');
const EXE = join(INSTALL_DIR, 'Scia.exe');
const UNINSTALLER = join(INSTALL_DIR, 'Uninstall Scia.exe');
// What the packing fetched beside the engine (electron-builder.yml, `extraResources`; ADR 0009).
const YT_DLP = join(INSTALL_DIR, 'resources', 'tools', YT_DLP_OF_PLATFORM.win32!.file);
// NSIS installs in seconds; a cold runner's disk is slow, and an uninstaller hands itself to a
// copy in the temporary folder and returns before it has removed anything.
const INSTALL_LIMIT_MS = 120_000;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

// The installer is installed on the machine that runs this, over any Scia already there, and
// removed afterwards: never on a person's computer (ADR 0008). The specs are one road, in order.
describe('the installer, installed and started', () => {
  let profile: Profile | undefined;
  let scia: Scia | undefined;
  let host: RangeServer | undefined;

  beforeAll(async () => {
    if (
      process.env.CI !== 'true' ||
      process.platform !== 'win32' ||
      INSTALLER === undefined ||
      VERSION === undefined
    ) {
      throw new Error(
        'The smoke test installs Scia over the one on this machine: it runs on a Windows CI runner only, with SCIA_INSTALLER and SCIA_VERSION set.',
      );
    }
    profile = await scratchProfile();
  });

  // On a CI runner nothing else of the run is kept.
  afterEach(async ({ task }) => {
    if (task.result?.state === 'fail' && profile !== undefined) {
      console.error(`main.log of ${profile.path}:\n${await profile.log()}`);
    }
  });

  afterAll(async () => {
    await scia?.close();
    await host?.close();
    await profile?.remove();
  });

  it('installs silently, into a folder of its own', async () => {
    await run(INSTALLER!, ['/S'], { timeout: INSTALL_LIMIT_MS });

    expect(await exists(EXE)).toBe(true);
    expect(await exists(UNINSTALLER)).toBe(true);
  });

  it('ships yt-dlp at the version it fixes, and yt-dlp answers', async () => {
    const { stdout } = await run(YT_DLP, ['--version'], { timeout: 60_000 });

    expect(stdout.trim()).toBe(YT_DLP_VERSION);
  });

  it('starts on a scratch profile as the packaged app of its version', async () => {
    scia = await launchScia(profile!, { executable: EXE });

    const log = await profile!.log();
    expect(log).toContain(`boot { version: '${VERSION!}', packaged: true`);
    expect(log).toContain('engine_ready');
    expect(log).not.toMatch(/\[error\]/);
  });

  it('downloads a pasted link from a local host, byte for byte', async () => {
    const body = randomBytes(4 * 1024 * 1024);
    host = await startRangeServer({ body, fileName: 'sample.bin' });

    await paste(scia!.page, host.url);

    await rowOf(scia!.page, 'sample.bin')
      .getByRole('button', { name: 'Show in folder' })
      .waitFor({ timeout: 30_000 });
    const written = await readFile(join(profile!.downloads, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
  });

  it('quits when its window is closed with nothing to download', async () => {
    await scia!.closeWindow();

    await scia!.exited;
    scia = undefined;
    expect(await profile!.log()).toMatch(/\bquit\b/);
  });

  it('uninstalls silently, leaving no program behind', async () => {
    await run(UNINSTALLER, ['/S'], { timeout: INSTALL_LIMIT_MS });

    // The uninstaller removes the program, then itself, then its folder: the folder is the end.
    await until(async () => !(await exists(INSTALL_DIR)), INSTALL_LIMIT_MS);
  });
});
