import { spawn } from 'node:child_process';
import { load, out, pointer } from 'koffi';
import { type Browser, chromium, type Page } from 'playwright-core';
import {
  alive,
  endProcess,
  type Profile,
  START_LIMIT_MS,
  startLocalHosts,
  until,
  within,
} from './scia.ts';

// The installed exe as it ships, with its --inspect fuse off (electron-builder.yml, #115):
// playwright-core's Electron driver reaches main through --inspect and cannot start it. The page is
// reached by Chromium's own debugging port, which Electron answers without main, and the window is
// closed as its X closes it, by the system's WM_CLOSE. Nothing is asked of main.
export interface InstalledScia {
  readonly page: Page;
  // Closes the window as its X does: a close the window prevents and hands to main.
  closeWindow(): void;
  // Resolves when the process has ended, however it ended.
  readonly exited: Promise<void>;
  // Ends the process, by force when it has not ended, and what was started with it.
  close(): Promise<void>;
  // What the process wrote to stderr so far: Chromium's lines, and Node's.
  stderr(): string;
}

// What Chromium writes to stderr once its debugging port is open (port 0: one the system chose).
const DEVTOOLS = /DevTools listening on (ws:\/\/\S+)/;

export async function launchInstalled(
  profile: Profile,
  exe: string,
  args: readonly string[] = [],
): Promise<InstalledScia> {
  const hosts = await startLocalHosts();
  const child = spawn(
    exe,
    [
      `--user-data-dir=${profile.path}`,
      '--port=0',
      ...hosts.args,
      '--remote-debugging-port=0',
      ...args,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const exited = new Promise<void>((done) => {
    child.once('exit', () => {
      done();
    });
    child.once('error', () => {
      done();
    });
  });
  // Read to its end, or a full pipe would hold Chromium's next write.
  let stderr = '';
  const endpoint = new Promise<string>((found, failed) => {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length > 64 * 1024) return;
      stderr += chunk;
      const address = DEVTOOLS.exec(stderr)?.[1];
      if (address !== undefined) found(address);
    });
    void exited.then(() => {
      failed(new Error(`Scia ended before its debugging port was open:\n${stderr}`));
    });
  });

  let browser: Browser | undefined;
  const close = async () => {
    if (child.pid !== undefined) await endProcess(child.pid);
    await browser?.close().catch(() => undefined);
    await hosts.close();
  };
  try {
    browser = await chromium.connectOverCDP(
      await within(endpoint, START_LIMIT_MS, 'Scia opened no debugging port'),
      { timeout: START_LIMIT_MS },
    );
    const [context] = browser.contexts();
    if (context === undefined) throw new Error('Scia has no browser context.');
    await until(() => context.pages().length > 0, START_LIMIT_MS);
    const [page] = context.pages();
    if (page === undefined) throw new Error('Scia has no page.');
    // The window exists before it has a page: it follows the engine once the engine is ready.
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: START_LIMIT_MS });
    await page.getByRole('textbox', { name: 'Links to download' }).waitFor();
    return {
      page,
      exited,
      close,
      stderr: () => stderr,
      closeWindow: () => {
        if (child.pid === undefined || !alive(child.pid)) throw new Error('Scia is not running.');
        closeWindowOf(child.pid);
      },
    };
  } catch (error) {
    // A start that failed leaves no Scia running, holding the profile.
    await close();
    throw error;
  }
}

const WM_CLOSE = 0x0010;
// Chromium's class for a top-level window: a BrowserWindow's, among others.
const WINDOW_CLASS = 'Chrome_WidgetWin_1';

// koffi answers a handle as a number, or as a bigint where it does not fit one.
type Handle = number | bigint;

// Posts WM_CLOSE to the one window the process shows, as the system does when its X is pressed.
function closeWindowOf(pid: number): void {
  const user32 = load('user32.dll');
  const findWindow = user32.func('__stdcall', 'FindWindowExW', 'uintptr_t', [
    'uintptr_t',
    'uintptr_t',
    'str16',
    'str16',
  ]) as (parent: Handle, after: Handle, windowClass: string, title: null) => Handle;
  const processOf = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32_t', [
    'uintptr_t',
    out(pointer('uint32_t')),
  ]) as (window: Handle, owner: [number]) => number;
  const isVisible = user32.func('__stdcall', 'IsWindowVisible', 'bool', ['uintptr_t']) as (
    window: Handle,
  ) => boolean;
  const post = user32.func('__stdcall', 'PostMessageW', 'bool', [
    'uintptr_t',
    'uint32_t',
    'uintptr_t',
    'intptr_t',
  ]) as (window: Handle, message: number, wParam: number, lParam: number) => boolean;

  const shown: Handle[] = [];
  for (
    let window = findWindow(0, 0, WINDOW_CLASS, null);
    BigInt(window) !== 0n;
    window = findWindow(0, window, WINDOW_CLASS, null)
  ) {
    const owner: [number] = [0];
    processOf(window, owner);
    if (owner[0] === pid && isVisible(window)) shown.push(window);
  }
  const [window] = shown;
  if (window === undefined || shown.length > 1) {
    throw new Error(`Scia shows ${String(shown.length)} windows, not one.`);
  }
  if (!post(window, WM_CLOSE, 0, 0)) throw new Error('WM_CLOSE could not be posted.');
}
