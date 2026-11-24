import { randomBytes } from 'node:crypto';
import { open, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_THEME, Theme, WINDOW_COLOURS } from '@scia/contracts/theme';
import { DownloadStatus } from '@scia/core';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { ElectronApplication } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { STARTING_LINE } from '../src/engine/starting-page.ts';
import { HIDDEN_TO_TRAY_NOTICE } from '../src/engine/tray-presentation.ts';
import { allCompleted, downloadsOf, paste, until, useRun } from './scia.ts';
import { EndSession, endSessionOf, sessionMayEnd } from './session-end.ts';

const STARTING_PAGE = 'data:text/html;charset=utf-8,';

// The first page the window loaded, as its history keeps it: what it showed before the engine's.
async function firstPageOf(app: ElectronApplication): Promise<string> {
  const address = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.navigationHistory.getEntryAtIndex(0).url ?? '',
  );
  return address.startsWith(STARTING_PAGE)
    ? decodeURIComponent(address.slice(STARTING_PAGE.length))
    : address;
}

// The start of every range a host was asked for, but the probe of the first byte that begins
// every run of a download.
const startsOf = (ranges: readonly (string | undefined)[]) =>
  ranges.flatMap((range) => {
    const start = /^bytes=(\d+)-/.exec(range ?? '')?.[1];
    return start === undefined || range === 'bytes=0-0' ? [] : [Number(start)];
  });

// Holds a file of the profile open from the spec's own process, as an antivirus or the indexer
// reading it does — on Windows a rename onto it is refused meanwhile (#307) — until main has begun
// to write it, and a while after: its `.tmp` beside it is read from the folder, never by opening
// either file, which would hold it too. The while is the case itself, well inside the two seconds
// main waits for the file.
async function heldWhileWritten(
  folder: string,
  name: string,
  write: () => Promise<void>,
): Promise<void> {
  const reader = await open(join(folder, name), 'r');
  try {
    await write();
    await until(async () => (await readdir(folder)).includes(`${name}.tmp`));
    await sleep(300);
  } finally {
    await reader.close();
  }
}

interface Segment {
  readonly start: number;
  readonly end: number;
  readonly downloaded: number;
}

describe('the real app, from start to quit', () => {
  const run = useRun();

  it('quits when its window is closed with nothing to download', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);

    await scia.closeWindow();

    await scia.exited;
    // The engine's `stopped`, relayed from its output, is read before Quit's own last line (#273).
    expect(await profile.log()).toMatch(/"event":"stopped"[\s\S]*\squit\s*$/m);
  });

  it('stays in the tray when its window is closed during a download, and finishes it', async () => {
    const profile = await run.profile();
    const body = randomBytes(2 * 1024 * 1024);
    // Slow enough that the download is still running when the window is closed.
    const host = run.keep(
      await startRangeServer({ body, chunkBytes: 16 * 1024, chunkDelayMs: 40 }),
    );
    const scia = await run.launch(profile);
    const { page } = scia;
    await paste(page, host.url);
    await until(async () =>
      (await downloadsOf(page)).some((download) => download.status === DownloadStatus.Downloading),
    );

    await scia.closeWindow();

    await until(async () => (await profile.log()).includes('window_hidden_to_tray'));
    expect(
      await scia.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
    ).toBe(false);
    await until(() => allCompleted(page));
    const written = await readFile(join(profile.downloads, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
  });

  it('keeps the notice of the first hide while another program holds notices.json for a moment', async () => {
    const profile = await run.profile();
    // The notices of an earlier start, for another program to read.
    await writeFile(join(profile.path, 'notices.json'), '[]');
    const body = randomBytes(2 * 1024 * 1024);
    const host = run.keep(
      await startRangeServer({ body, chunkBytes: 16 * 1024, chunkDelayMs: 40 }),
    );
    const scia = await run.launch(profile);
    await paste(scia.page, host.url);
    await until(async () =>
      (await downloadsOf(scia.page)).some(
        (download) => download.status === DownloadStatus.Downloading,
      ),
    );

    await heldWhileWritten(profile.path, 'notices.json', () => scia.closeWindow());
    await until(async () => /notices_(not_)?kept/.test(await profile.log()));

    const log = await profile.log();
    expect(log).toContain(`notices_kept { notice: '${HIDDEN_TO_TRAY_NOTICE.id}' }`);
    expect(log).not.toContain('notices_not_kept');
    await scia.quit();
    expect(JSON.parse(await readFile(join(profile.path, 'notices.json'), 'utf8'))).toEqual([
      HIDDEN_TO_TRAY_NOTICE.id,
    ]);
  });

  // The window shows before the engine is ready, on a page of main's own: a cold start can take a
  // minute (#13).
  it('shows its window at once, saying that Scia is starting', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);

    const log = await profile.log();
    const starting = /window_starting { theme: '([\w-]+)', visible: (\w+) }/.exec(log);
    expect(starting?.slice(1)).toEqual([DEFAULT_THEME, 'true']);
    expect(log.indexOf('window_starting')).toBeLessThan(log.indexOf('engine_ready'));
    const first = await firstPageOf(scia.app);
    expect(first).toContain(STARTING_LINE);
    expect(first).toContain(WINDOW_COLOURS[DEFAULT_THEME].dark.background);
  });

  it('starts the next time in the theme chosen in Settings', async () => {
    const profile = await run.profile();
    const first = await run.launch(profile);
    await first.page.getByRole('button', { name: 'Settings' }).click();
    await first.page.getByRole('combobox', { name: 'Theme' }).selectOption(Theme.Ice);
    // Main says when the write landed. Never by reading theme.json meanwhile: on Windows a file
    // another process has open cannot be renamed onto, and a spec that read it every 10 ms made
    // main's write fail (#280; .claude/gotchas.md, #137).
    await until(async () => (await profile.log()).includes(`theme_kept { theme: '${Theme.Ice}' }`));
    await first.quit();
    expect(JSON.parse(await readFile(join(profile.path, 'theme.json'), 'utf8'))).toEqual({
      theme: Theme.Ice,
    });

    const again = await run.launch(profile);

    expect(await profile.log()).toContain(`window_starting { theme: '${Theme.Ice}'`);
    const page = await firstPageOf(again.app);
    expect(page).toContain(WINDOW_COLOURS[Theme.Ice].light.background);
    expect(page).toContain(WINDOW_COLOURS[Theme.Ice].dark.background);
  });

  it('keeps the theme chosen while another program holds theme.json for a moment', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    // The theme of the first start, kept once the engine said it: the file another program reads.
    await until(async () =>
      (await profile.log()).includes(`theme_kept { theme: '${DEFAULT_THEME}' }`),
    );

    await heldWhileWritten(profile.path, 'theme.json', async () => {
      await scia.page.getByRole('button', { name: 'Settings' }).click();
      await scia.page.getByRole('combobox', { name: 'Theme' }).selectOption(Theme.Ice);
    });
    await until(async () =>
      new RegExp(`theme_(not_)?kept { theme: '${Theme.Ice}' }`).test(await profile.log()),
    );

    const log = await profile.log();
    expect(log).toContain(`theme_kept { theme: '${Theme.Ice}' }`);
    expect(log).not.toContain('theme_not_kept');
    await scia.quit();
    expect(JSON.parse(await readFile(join(profile.path, 'theme.json'), 'utf8'))).toEqual({
      theme: Theme.Ice,
    });
  });

  // Windows tells every top-level window, a hidden one too, that the session ends: at a shutdown
  // or a sign-out, and when an installer needs Scia's files (#13). Electron's `before-quit` never
  // comes, and the process may be ended as soon as the message is answered.
  it.each([
    { what: 'a shutdown, with Scia in the tray', how: EndSession.Shutdown, hidden: true },
    { what: 'a sign-out, with Scia in the tray', how: EndSession.Logoff, hidden: true },
    { what: 'an installer that needs its files', how: EndSession.CloseApp, hidden: false },
  ])(
    'writes its state and ends at $what during a download, which goes on at the next start',
    async ({ how, hidden }) => {
      const profile = await run.profile();
      // Slow enough that the download is still running when the session ends: seconds.
      const body = randomBytes(8 * 1024 * 1024);
      const host = run.keep(
        await startRangeServer({ body, chunkBytes: 16 * 1024, chunkDelayMs: 100 }),
      );
      const scia = await run.launch(profile);
      await paste(scia.page, host.url);
      await until(async () =>
        (await downloadsOf(scia.page)).some((download) => download.downloadedBytes > 0),
      );
      if (hidden) {
        await scia.closeWindow();
        await until(async () => (await profile.log()).includes('window_hidden_to_tray'));
      }
      const pid = await scia.app.evaluate(() => process.pid);

      // It does not ask Windows to wait.
      expect(sessionMayEnd(pid, how)).toBe(true);
      endSessionOf(pid, how);

      await scia.exited;
      // What the engine wrote as it stopped, read first: a download it was stopping is `queued`,
      // one it was killed in the middle of stays `downloading` at its last checkpoint.
      const state = JSON.parse(
        await readFile(join(profile.path, 'engine', 'state.json'), 'utf8'),
      ) as { downloads: { status: string; segments: Segment[] }[] };
      expect(state.downloads[0]?.status).toBe(DownloadStatus.Queued);
      expect(state.downloads[0]?.segments.some((segment) => segment.downloaded > 0)).toBe(true);
      const log = await profile.log();
      expect(log).toMatch(/\bsession_ended\b/);
      // Quit's own last line, written once the engine's process has ended: Scia ended itself, not
      // Electron at once. Before it, the engine's own `stopped`, relayed from its output, which
      // the stop now reads to its end: two runs in three of #262's round 2 lost it (#273).
      expect(log).toMatch(/"event":"stopped"[\s\S]*\squit\s*$/m);
      expect(log).toMatch(/\squit\s*$/m);
      expect(log).not.toContain('update_installing');

      const again = await run.launch(profile);

      await until(() => allCompleted(again.page));
      const written = await readFile(join(profile.downloads, 'sample.bin'));
      expect(Buffer.compare(written, body)).toBe(0);
    },
  );

  it('takes a download up again after a restart, each connection from the bytes it had', async () => {
    const profile = await run.profile();
    const body = randomBytes(4 * 1024 * 1024);
    const host = run.keep(
      await startRangeServer({ body, chunkBytes: 16 * 1024, chunkDelayMs: 40 }),
    );
    const first = await run.launch(profile);
    await paste(first.page, host.url);
    await until(async () =>
      (await downloadsOf(first.page)).some(
        (download) => download.downloadedBytes > body.length / 4,
      ),
    );

    await first.quit();
    // What the engine kept when it stopped: each connection's range, and how much of it is on disk.
    const state = JSON.parse(
      await readFile(join(profile.path, 'engine', 'state.json'), 'utf8'),
    ) as { downloads: { segments: Segment[] }[] };
    const unfinished = state.downloads[0]!.segments.filter(
      (segment) => segment.start + segment.downloaded < segment.end,
    );
    const askedBefore = host.ranges.length;
    const again = await run.launch(profile);

    await until(() => allCompleted(again.page));
    const written = await readFile(join(profile.downloads, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
    expect(unfinished.length).toBeGreaterThan(1);
    const askedAfter = new Set(startsOf(host.ranges.slice(askedBefore)));
    for (const segment of unfinished) {
      expect(askedAfter).toContain(segment.start + segment.downloaded);
    }
  });
});
