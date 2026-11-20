import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadStatus } from '@scia/core';
import { type RangeServer, startRangeServer } from '@scia/server/testing/range-server.ts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allCompleted,
  sayWhyItFailed,
  downloadsOf,
  launchScia,
  paste,
  type Profile,
  type Scia,
  scratchProfile,
  until,
} from './scia.ts';

// The start of every range a host was asked for.
const startsOf = (ranges: readonly (string | undefined)[]) =>
  ranges.flatMap((range) => {
    const start = /^bytes=(\d+)-/.exec(range ?? '')?.[1];
    return start === undefined ? [] : [Number(start)];
  });

describe('the real app, from start to quit', () => {
  let profile: Profile;
  let scia: Scia | undefined;
  let host: RangeServer | undefined;

  afterEach(async ({ task }) => {
    await sayWhyItFailed(task, profile);
    await scia?.app.close().catch(() => undefined);
    await host?.close();
    await profile.remove();
    scia = undefined;
    host = undefined;
  });

  it('quits when its window is closed with nothing to download', async () => {
    profile = await scratchProfile();
    scia = await launchScia(profile);

    await scia.closeWindow();

    await scia.exited;
    expect(await profile.log()).toMatch(/\bquit\b/);
  });

  it('stays in the tray when its window is closed during a download, and finishes it', async () => {
    profile = await scratchProfile();
    const body = randomBytes(2 * 1024 * 1024);
    // Slow enough that the download is still running when the window is closed.
    host = await startRangeServer({ body, chunkBytes: 16 * 1024, chunkDelayMs: 40 });
    scia = await launchScia(profile);
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

  it('takes a download up again after a restart, from the bytes it had', async () => {
    profile = await scratchProfile();
    const body = randomBytes(4 * 1024 * 1024);
    host = await startRangeServer({ body, chunkBytes: 16 * 1024, chunkDelayMs: 40 });
    scia = await launchScia(profile);
    await paste(scia.page, host.url);
    const page = scia.page;
    await until(async () =>
      (await downloadsOf(page)).some((download) => download.downloadedBytes > body.length / 4),
    );

    await scia.quit();
    const askedBefore = new Set(startsOf(host.ranges));
    const firstRun = host.ranges.length;
    scia = await launchScia(profile);

    const again = scia.page;
    await until(() => allCompleted(again));
    const written = await readFile(join(profile.downloads, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
    // The second run asks from where each connection stopped, not from where it began.
    const askedAfter = startsOf(host.ranges.slice(firstRun));
    expect(askedAfter.length).toBeGreaterThan(0);
    expect(askedAfter.some((start) => !askedBefore.has(start))).toBe(true);
  });
});
