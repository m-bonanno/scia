import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadStatus } from '@scia/core';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import { describe, expect, it } from 'vitest';
import { allCompleted, downloadsOf, paste, until, useRun } from './scia.ts';

// The start of every range a host was asked for, but the probe of the first byte that begins
// every run of a download.
const startsOf = (ranges: readonly (string | undefined)[]) =>
  ranges.flatMap((range) => {
    const start = /^bytes=(\d+)-/.exec(range ?? '')?.[1];
    return start === undefined || range === 'bytes=0-0' ? [] : [Number(start)];
  });

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
    expect(await profile.log()).toMatch(/\bquit\b/);
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
