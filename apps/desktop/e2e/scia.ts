import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { API_PREFIX, type Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { startAllDebridServer } from '@scia/server/testing/alldebrid-server.ts';
import { until as untilWithin } from '@scia/server/testing/scratch.ts';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterEach } from 'vitest';

// The built app: `npm run build` first. main.cjs, the engine's bundle and the page's files are
// what Electron loads from here, as it does under `npm start`.
const APP_DIR = resolve(import.meta.dirname, '..');

// A first start on a CI runner is slow, and never tuned against a warm one (apps/desktop/CLAUDE.md).
const START_LIMIT_MS = 60_000;
// A state of the app comes later than an adapter's: a window, an engine, a cold runner.
const STATE_LIMIT_MS = 30_000;
// Quitting never hangs (apps/desktop/CLAUDE.md): the engine is stopped within its own limit.
const QUIT_LIMIT_MS = 30_000;
// A process that has not ended by then is ended: a spec never leaves a Scia behind it.
const CLOSE_LIMIT_MS = 15_000;
// Main answers in tens of milliseconds while it is not blocked.
const PID_LIMIT_MS = 5_000;

// Waits for a state of the app (`until` of the other layers, with the app's limit).
export const until = (condition: () => boolean | Promise<boolean>, limitMs = STATE_LIMIT_MS) =>
  untilWithin(condition, limitMs);

export interface Profile {
  readonly path: string;
  // Where a run on its own profile downloads (engine/runtime-layout.ts).
  readonly downloads: string;
  log(): Promise<string>;
  remove(): Promise<void>;
}

// A profile of its own for each spec: its engine, its log, its downloads, its single-instance
// lock — never the person's, never another spec's.
export async function scratchProfile(): Promise<Profile> {
  const path = await mkdtemp(join(tmpdir(), 'scia-e2e-'));
  return {
    path,
    downloads: join(path, 'downloads'),
    log: () => readFile(join(path, 'logs', 'main.log'), 'utf8').catch(() => ''),
    remove: () => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

export interface Scia {
  readonly app: ElectronApplication;
  readonly page: Page;
  // Where the engine listens: the page is served from it.
  readonly origin: string;
  // Closes the window as its X does: a close the window prevents and hands to main.
  closeWindow(): Promise<void>;
  // Quits as the tray's "Quit" does, and waits for the process to end.
  quit(): Promise<void>;
  // Resolves when the process has ended, however it ended.
  readonly exited: Promise<void>;
  // Ends the process, by force when it does not end by itself, and what was started with it.
  close(): Promise<void>;
}

export interface LaunchOptions {
  readonly args?: readonly string[];
  // A packaged Scia's exe — the installed one, for the installer's smoke test. The built app
  // otherwise.
  readonly executable?: string;
}

const within = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(what);
    }),
  ]);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Ends Scia's main and every process it started — the engine, the window's. On Windows
// playwright-core starts Electron through a shell, and `app.process()` is that shell: killing it
// leaves Electron running on the profile. Main is found by the pid it reports itself.
async function end(app: ElectronApplication, main: number): Promise<void> {
  try {
    await within(app.close(), CLOSE_LIMIT_MS, 'Scia did not close');
  } catch {
    // Closing failed: main can be blocked on a dialog nobody will answer.
  }
  if (!alive(main)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(main), '/T', '/F'], { timeout: CLOSE_LIMIT_MS });
  } else {
    process.kill(main, 'SIGKILL');
  }
  await until(() => !alive(main), CLOSE_LIMIT_MS);
}

// The process playwright-core started Electron with. Never 0: ended "by pid 0", a whole process
// group would be — the runner's own.
function shellOf(app: ElectronApplication): number {
  const { pid } = app.process();
  if (pid === undefined) throw new Error('Scia was started with no process to end.');
  return pid;
}

// Starts Scia as a person starts it, with its own profile and a free port for its engine — and,
// unless the spec names one, a simulated AllDebrid that knows no account: with no service
// connected Scia still asks AllDebrid which hosts are its own (ADR 0006), and a spec reaches no
// host but this computer's.
export async function launchScia(profile: Profile, options: LaunchOptions = {}): Promise<Scia> {
  const args = options.args ?? [];
  if (args.some((arg) => arg.startsWith('--port=') || arg.startsWith('--user-data-dir='))) {
    // Main takes the first of each, and these come first: a spec's own would be ignored.
    throw new Error('launchScia sets the port and the profile itself.');
  }
  const service = args.some((arg) => arg.startsWith('--alldebrid-api='))
    ? undefined
    : await startAllDebridServer({ accounts: {} });
  const app = await _electron
    .launch({
      // A packaged exe carries its app; Electron's own exe is told where the built one is.
      ...(options.executable === undefined ? {} : { executablePath: options.executable }),
      args: [
        ...(options.executable === undefined ? [APP_DIR] : []),
        `--user-data-dir=${profile.path}`,
        '--port=0',
        ...(service === undefined ? [] : [`--alldebrid-api=${service.api}`]),
        ...args,
      ],
      timeout: START_LIMIT_MS,
    })
    .catch(async (error: unknown) => {
      await service?.close();
      throw error;
    });
  const exited = new Promise<void>((done) => {
    app.process().once('exit', () => {
      done();
    });
  });
  // Asked at once and bounded: main stops answering once it shows the error box of an engine
  // that never started, moments after the launch. When main cannot say, the shell is ended with
  // its tree, Electron being its child.
  const main = await within(
    app.evaluate(() => process.pid),
    PID_LIMIT_MS,
    'no pid',
  ).catch(() => shellOf(app));
  const close = async () => {
    await end(app, main);
    await service?.close();
  };
  try {
    const page = await app.firstWindow({ timeout: START_LIMIT_MS });
    // The window exists before it has a page: it follows the engine once the engine is ready.
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: START_LIMIT_MS });
    await page.getByRole('textbox', { name: 'Links to download' }).waitFor();
    return {
      app,
      page,
      origin: new URL(page.url()).origin,
      exited,
      close,
      closeWindow: () =>
        app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.close();
        }),
      quit: async () => {
        await app.evaluate(({ app: electron }) => {
          electron.quit();
        });
        await within(exited, QUIT_LIMIT_MS, 'Scia did not end after a quit');
        await service?.close();
      },
    };
  } catch (error) {
    // A start that failed leaves no Scia running, holding the profile.
    await close();
    throw error;
  }
}

// What a spec started, ended after it whatever happened: its apps, its hosts, its profiles —
// after main's log of a spec that failed is printed, as on a CI runner nothing else is kept.
export interface Run {
  profile(): Promise<Profile>;
  launch(profile: Profile, options?: LaunchOptions): Promise<Scia>;
  // A host or a service, closed after the spec.
  keep<T extends { close(): Promise<void> }>(thing: T): T;
}

export function useRun(): Run {
  let profiles: Profile[] = [];
  let apps: Scia[] = [];
  let kept: { close(): Promise<void> }[] = [];

  afterEach(async ({ task }) => {
    const failed = task.result?.state === 'fail';
    for (const scia of apps) await scia.close();
    for (const thing of kept) await thing.close();
    for (const profile of profiles) {
      if (failed) console.error(`main.log of ${profile.path}:\n${await profile.log()}`);
      await profile.remove();
    }
    profiles = [];
    apps = [];
    kept = [];
  });

  return {
    profile: async () => {
      const profile = await scratchProfile();
      profiles.push(profile);
      return profile;
    },
    launch: async (profile, options) => {
      const scia = await launchScia(profile, options);
      apps.push(scia);
      return scia;
    },
    keep: (thing) => {
      kept.push(thing);
      return thing;
    },
  };
}

// Pastes links into the bar and presses its button, as a person does.
export async function paste(page: Page, ...urls: string[]): Promise<void> {
  await page.getByRole('textbox', { name: 'Links to download' }).fill(urls.join('\n'));
  await page.getByRole('button', { name: /^Download/ }).click();
}

// The engine's list, read as the page reads it: for what a row does not say, such as how many
// bytes have arrived.
export async function downloadsOf(page: Page): Promise<Download[]> {
  return page.evaluate(async (prefix) => {
    const { apiToken } = (window as unknown as { scia: { apiToken: string } }).scia;
    const response = await fetch(`${prefix}/downloads`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    return ((await response.json()) as { data: Download[] }).data;
  }, API_PREFIX);
}

// The row of a download, by the file name it shows.
export function rowOf(page: Page, fileName: string) {
  return page.getByRole('listitem').filter({ has: page.getByTitle(fileName, { exact: true }) });
}

// Every download of the list has completed — and there is one: an empty list is not a finished one.
export async function allCompleted(page: Page): Promise<boolean> {
  const downloads = await downloadsOf(page);
  return (
    downloads.length > 0 &&
    downloads.every((download) => download.status === DownloadStatus.Completed)
  );
}
