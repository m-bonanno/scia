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

// What Chromium writes to stderr once its debugging port is open (port 0: one the system chose),
// read once its line has ended.
const DEVTOOLS = /DevTools listening on (ws:\/\/\S+)\r?\n/;
// Chromium lists its targets in milliseconds.
const TARGETS_LIMIT_MS = 2_000;
// The page the engine serves, once the window has loaded it.
const APP_PAGE = /^http:\/\/127\.0\.0\.1:\d+\//;

// Whether the debugging port lists the app's page, loaded: playwright-core, connected to a window
// that has loaded nothing, asks it for what only a renderer answers and waits for ever. Its
// Electron driver is told not to; connectOverCDP cannot be, so it connects once the page is there.
const pageLoaded = async (endpoint: string) =>
  (await targetsOf(endpoint)).some(
    (target) => target.type === 'page' && APP_PAGE.test(target.url ?? ''),
  );

interface Target {
  readonly type?: string;
  readonly url?: string;
}

// What the debugging port lists: none when it does not answer.
async function targetsOf(endpoint: string): Promise<Target[]> {
  const list = new URL(endpoint);
  list.protocol = 'http:';
  list.pathname = '/json/list';
  try {
    // Bounded: a port that holds the answer must not outlast the start's limit (.claude/gotchas.md).
    const answer = await fetch(list, { signal: AbortSignal.timeout(TARGETS_LIMIT_MS) });
    return (await answer.json()) as Target[];
  } catch {
    return [];
  }
}

export async function launchInstalled(
  profile: Profile,
  exe: string,
  args: readonly string[] = [],
): Promise<InstalledScia> {
  if (args.some((arg) => arg.startsWith('--port=') || arg.startsWith('--user-data-dir='))) {
    // Main takes the first of each, and these come first: a spec's own would be ignored.
    throw new Error('launchInstalled sets the port and the profile itself.');
  }
  const hosts = await startLocalHosts(args);
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
  let address: string | undefined;
  try {
    const opened = await within(endpoint, START_LIMIT_MS, 'Scia opened no debugging port');
    address = opened;
    // The window exists before it has a page: it follows the engine once the engine is ready.
    await until(() => pageLoaded(opened), START_LIMIT_MS);
    browser = await chromium.connectOverCDP(opened, { timeout: START_LIMIT_MS });
    const [context] = browser.contexts();
    if (context === undefined) throw new Error('Scia has no browser context.');
    await until(() => context.pages().length > 0, START_LIMIT_MS);
    const [page] = context.pages();
    if (page === undefined) throw new Error('Scia has no page.');
    await page.waitForURL(APP_PAGE, { timeout: START_LIMIT_MS });
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
    // Read before the end: what the exe said, and what its port listed, are seen on a CI runner
    // only.
    const targets = address === undefined ? [] : await targetsOf(address);
    // A start that failed leaves no Scia running, holding the profile.
    await close();
    throw new Error(
      `Scia did not start: ${String(error)}
Its debugging port listed ${JSON.stringify(targets)}
Its stderr:
${stderr}`,
      { cause: error },
    );
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
  // A BOOL is an int, not koffi's one-byte bool.
  const isVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['uintptr_t']) as (
    window: Handle,
  ) => number;
  const post = user32.func('__stdcall', 'PostMessageW', 'int', [
    'uintptr_t',
    'uint32_t',
    'uintptr_t',
    'intptr_t',
  ]) as (window: Handle, message: number, wParam: number, lParam: number) => number;

  const shown: Handle[] = [];
  for (
    let window = findWindow(0, 0, WINDOW_CLASS, null);
    BigInt(window) !== 0n;
    window = findWindow(0, window, WINDOW_CLASS, null)
  ) {
    const owner: [number] = [0];
    processOf(window, owner);
    if (owner[0] === pid && isVisible(window) !== 0) shown.push(window);
  }
  const [window] = shown;
  if (window === undefined || shown.length > 1) {
    throw new Error(`Scia shows ${String(shown.length)} windows, not one.`);
  }
  if (post(window, WM_CLOSE, 0, 0) === 0) throw new Error('WM_CLOSE could not be posted.');
}
