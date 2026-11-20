import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { API_PREFIX, type Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';

// The built app: `npm run build` first. main.cjs, the engine's bundle and the page's files are
// what Electron loads from here, as it does under `npm start`.
const APP_DIR = resolve(import.meta.dirname, '..');

// A first start on a CI runner is slow, and never tuned against a warm one (apps/desktop/CLAUDE.md).
const START_LIMIT_MS = 60_000;

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
}

export interface LaunchOptions {
  readonly args?: readonly string[];
}

// Starts Scia as a person starts it, with its own profile and a free port for its engine.
export async function launchScia(profile: Profile, options: LaunchOptions = {}): Promise<Scia> {
  const app = await _electron.launch({
    args: [APP_DIR, `--user-data-dir=${profile.path}`, '--port=0', ...(options.args ?? [])],
    timeout: START_LIMIT_MS,
  });
  const exited = new Promise<void>((done) => {
    app.process().once('exit', () => {
      done();
    });
  });
  const page = await app.firstWindow({ timeout: START_LIMIT_MS });
  // The window exists before it has a page: it follows the engine once the engine is ready.
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: START_LIMIT_MS });
  const origin = new URL(page.url()).origin;
  await page.getByRole('textbox', { name: 'Links to download' }).waitFor();
  return {
    app,
    page,
    origin,
    exited,
    closeWindow: () =>
      app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close();
      }),
    quit: async () => {
      await app.evaluate(({ app: electron }) => {
        electron.quit();
      });
      await exited;
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

// Waits for a state of the app, without a fixed sleep; on `performance.now()`, which the
// system's clock does not move.
export async function until(
  condition: () => boolean | Promise<boolean>,
  limitMs = 30_000,
): Promise<void> {
  const deadline = performance.now() + limitMs;
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error('The condition never held.');
    await sleep(50);
  }
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

// A spec that failed prints main's log before its profile is removed: on a CI runner nothing
// else of the run is kept.
export async function sayWhyItFailed(
  task: { readonly result?: { readonly state?: string } },
  profile: Profile,
): Promise<void> {
  if (task.result?.state !== 'fail') return;
  console.error(`main.log of ${profile.path}:\n${await profile.log()}`);
}
