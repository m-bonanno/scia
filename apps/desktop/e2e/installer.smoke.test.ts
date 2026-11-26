import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DownloadStatus } from '@scia/core';
import { type RangeServer, startRangeServer } from '@scia/server/testing/range-server.ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { YT_DLP_OF_PLATFORM, YT_DLP_VERSION } from '../src/engine/runtime-layout.ts';
import { type InstalledScia, launchInstalled } from './installed.ts';
import { downloadsOf, paste, type Profile, rowOf, scratchProfile, until } from './scia.ts';

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

// Where electron-builder's installer writes what it installed, under a key named after the app:
// DisplayVersion under the uninstaller's, InstallLocation under the app's own.
const UNINSTALL_KEYS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
// Newer than any version this spec is run with.
const NEWER = '999.0.0';
// Windows' ERROR_PRODUCT_VERSION, the exit code of a refused install (build/installer.nsh).
const REFUSED = 1638;

const reg = async (...args: string[]) => (await run('reg', args, { timeout: 30_000 })).stdout;

// The uninstaller's key of the Scia this spec installed: the one whose uninstaller is in its folder.
const uninstallKey = async () => {
  const blocks = (await reg('query', UNINSTALL_KEYS, '/s', '/v', 'UninstallString')).split(
    /\r?\n\r?\n/,
  );
  const block = blocks.find((it) => it.toLowerCase().includes(UNINSTALLER.toLowerCase()));
  const key = block?.trim().split(/\r?\n/)[0];
  if (key === undefined) throw new Error(`No uninstaller key names ${UNINSTALLER}`);
  return key;
};

// eslint-disable-next-line no-restricted-syntax -- a registry key: a spec for Windows only
const appKey = (uninstall: string) => `HKCU\\Software\\${uninstall.split('\\').at(-1)!}`;

const displayVersion = async (key: string) =>
  /DisplayVersion\s+REG_SZ\s+(\S+)/.exec(await reg('query', key, '/v', 'DisplayVersion'))?.[1];

const setDisplayVersion = (key: string, version: string) =>
  reg('add', key, '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', version, '/f');

// What an install writes: the program's files and both keys. NSIS keeps the time a file was
// packed as its time of writing; a file it puts there again is created anew.
const footprint = async (key: string) => {
  const stamp = async (path: string) => {
    const { birthtimeMs, mtimeMs, size } = await stat(path);
    return { birthtimeMs, mtimeMs, size };
  };
  return {
    folder: await readdir(INSTALL_DIR),
    exe: await stamp(EXE),
    uninstaller: await stamp(UNINSTALLER),
    uninstallKey: await reg('query', key),
    appKey: await reg('query', appKey(key)),
  };
};

const exitCodeOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 0,
    (error: unknown) => (error as { code?: unknown }).code,
  );

// An error of main's, or of the engine's, which main copies into its log as a line of its own.
const errorsIn = (log: string) => /\[error\]|"level":"error"/.test(log);

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

// The installer is installed on the machine that runs this, over any Scia already there, and
// removed afterwards: never on a person's computer (ADR 0008). The specs are one road, in order.
describe('the installer, installed and started', () => {
  let profile: Profile | undefined;
  let scia: InstalledScia | undefined;
  let host: RangeServer | undefined;
  let slow: RangeServer | undefined;

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
    await slow?.close();
    await profile?.remove();
  });

  it('installs silently, into a folder of its own', async () => {
    await run(INSTALLER!, ['/S'], { timeout: INSTALL_LIMIT_MS });

    expect(await exists(EXE)).toBe(true);
    expect(await exists(UNINSTALLER)).toBe(true);
    expect(await displayVersion(await uninstallKey())).toBe(VERSION);
  });

  // The installer reads the version installed from the key every installer writes: a newer one
  // is made there, rather than installed (docs/adr/0018).
  it('refuses, silently and writing nothing, to install over a newer Scia', async () => {
    const key = await uninstallKey();
    await setDisplayVersion(key, NEWER);
    try {
      const before = await footprint(key);

      const code = await exitCodeOf(run(INSTALLER!, ['/S'], { timeout: INSTALL_LIMIT_MS }));

      expect(code).toBe(REFUSED);
      expect(await footprint(key)).toEqual(before);
    } finally {
      await setDisplayVersion(key, VERSION!);
    }
  });

  it('installs the same version again, as a repair', async () => {
    await run(INSTALLER!, ['/S'], { timeout: INSTALL_LIMIT_MS });

    expect(await exists(EXE)).toBe(true);
    expect(await displayVersion(await uninstallKey())).toBe(VERSION);
  });

  it('ships yt-dlp at the version it fixes, and yt-dlp answers', async () => {
    const { stdout } = await run(YT_DLP, ['--version'], { timeout: 60_000 });

    expect(stdout.trim()).toBe(YT_DLP_VERSION);
  });

  // As it ships: with no --inspect to reach main by (installed.ts, #115).
  it('starts on a scratch profile as the packaged app of its version', async () => {
    scia = await launchInstalled(profile!, EXE, ['--inspect=0']);

    // Its fuse is off (electron-builder.yml): asked to, main opened no debugger to anyone who can
    // start it. Node says so on the stderr Chromium's own port was read from.
    expect(scia.stderr()).toMatch(/DevTools listening on/);
    expect(scia.stderr()).not.toMatch(/Debugger listening on/);

    const log = await profile!.log();
    expect(log).toContain(`boot { version: '${VERSION!}', packaged: true`);
    expect(log).toContain('engine_ready');
    // The installed app loads its one native module, which asks Windows which window is in use
    // (ADR 0020): without it every notification would be decided as for another window.
    expect(log).toContain('foreground_ready');
    expect(log).not.toContain('foreground_unavailable');
    expect(errorsIn(log)).toBe(false);
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
    // The decision on its end was Windows' own, asked through koffi in the installed app (ADR 0020).
    await until(async () => /downloads_ended {[^}]*asked: 'answered'/.test(await profile!.log()));
  });

  // An update by hand: the installer tells the Scia that runs that its session ends, and Scia
  // writes its state and ends before anything is replaced (build/installer.nsh, #13).
  it('is closed with its state written by an installer run during a download, which goes on at its next start', async () => {
    const body = randomBytes(8 * 1024 * 1024);
    // Slow enough that the download is still running when the installer starts: seconds.
    slow = await startRangeServer({
      body,
      fileName: 'during-install.bin',
      chunkBytes: 16 * 1024,
      chunkDelayMs: 100,
    });
    await paste(scia!.page, slow.url);
    await until(async () =>
      (await downloadsOf(scia!.page)).some((download) => download.downloadedBytes > 0),
    );
    let ended = false;
    void scia!.exited.then(() => {
      ended = true;
    });

    await run(INSTALLER!, ['/S'], { timeout: INSTALL_LIMIT_MS });

    // The installer waited for it: it ended before the installer did.
    expect(ended).toBe(true);
    await scia!.close();
    // What the engine wrote as it stopped, read first: a download it was stopping is `queued`,
    // one it was killed in the middle of stays `downloading` at its last checkpoint.
    const state = JSON.parse(
      await readFile(join(profile!.path, 'engine', 'state.json'), 'utf8'),
    ) as { downloads: { fileName: string; status: string; segments: { downloaded: number }[] }[] };
    const during = state.downloads.find((download) => download.fileName === 'during-install.bin');
    expect(during?.status).toBe(DownloadStatus.Queued);
    expect(during?.segments.some((segment) => segment.downloaded > 0)).toBe(true);
    const log = await profile!.log();
    expect(log).toMatch(/session_ended {[^}]*'close-app'/);
    // Quit's own last line, written once the engine's process has ended: Scia ended itself, not
    // Electron at once. Before it, the engine's own `stopped`, relayed from its output, which the
    // stop now reads to its end (#273). Read from this end on: the profile has quit before.
    const thisEnd = log.slice(log.lastIndexOf('session_ended'));
    expect(thisEnd).toMatch(/"event":"stopped"[\s\S]*\squit\s*$/m);
    expect(log).toMatch(/\squit\s*$/m);
    expect(log).not.toContain('update_installing');

    scia = await launchInstalled(profile!, EXE);

    await rowOf(scia.page, 'during-install.bin')
      .getByRole('button', { name: 'Show in folder' })
      .waitFor({ timeout: 60_000 });
    const written = await readFile(join(profile!.downloads, 'during-install.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
  });

  it('quits when its window is closed with nothing to download', async () => {
    let ended = false;
    void scia!.exited.then(() => {
      ended = true;
    });

    scia!.closeWindow();

    await until(() => ended);
    // Its hosts and the connection to its port, which outlive it.
    await scia!.close();
    scia = undefined;
    const log = await profile!.log();
    expect(log).toMatch(/\bquit\b/);
    // Over the whole run, not only at its start.
    expect(errorsIn(log)).toBe(false);
    // A release's version updates itself (ADR 0007): what was tried is what is uninstalled.
    expect(log).not.toContain('update_installing');
  });

  it('uninstalls silently, leaving no program behind', async () => {
    await run(UNINSTALLER, ['/S'], { timeout: INSTALL_LIMIT_MS });

    // The uninstaller removes the program, then itself, then its folder: the folder is the end.
    await until(async () => !(await exists(INSTALL_DIR)), INSTALL_LIMIT_MS);
  });
});
