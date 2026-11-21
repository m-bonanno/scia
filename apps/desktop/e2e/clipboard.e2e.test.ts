import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadStatus } from '@scia/core';
import { startAllDebridServer } from '@scia/server/testing/alldebrid-server.ts';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { ElectronApplication, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { downloadsOf, type Profile, rowOf, until, useRun } from './scia.ts';

// Made up, as every key and every hash of a spec.
const KEY = 'e2e-made-up-key-0123456789';

interface Copied {
  sciaCopied?: string;
}

// The system's clipboard is the one thing answered for the person, in main, as the folder dialog
// is in settings.e2e: a process started under a job that limits the desktop — as a sandboxed shell
// is — cannot open it, and a spec must not take a person's clipboard either.
// Everything after Electron's read is the app's own.
const answerClipboard = (app: ElectronApplication) =>
  app.evaluate(({ clipboard }) => {
    const copied = globalThis as Copied;
    // Something was copied before Scia read the clipboard, as it nearly always is.
    copied.sciaCopied = 'copied before the switch was turned on';
    clipboard.readText = () => Promise.resolve(copied.sciaCopied ?? '');
  });

const copy = (app: ElectronApplication, text: string) =>
  app.evaluate((_electron, copied) => {
    (globalThis as Copied).sciaCopied = copied;
  }, text);

// Main says in its log when it starts and stops reading the clipboard: what is copied before it
// reads is what was there already, which it does not take.
const logged = (profile: Profile, event: string, times: number) =>
  until(async () => (await profile.log()).split(event).length > times);

// The switch shows what the engine kept: it moves once the engine has answered.
async function turn(page: Page, on: boolean): Promise<void> {
  const watch = page.getByRole('switch', { name: 'Take links from the clipboard' });
  await watch.click();
  await until(async () => (await watch.isChecked()) === on);
}

describe('the real app, with links copied to the clipboard', () => {
  const run = useRun();

  it('takes the files copied while the switch is on, ready, and downloads them at "Start all"', async () => {
    const profile = await run.profile();
    const body = randomBytes(256 * 1024);
    const host = run.keep(await startRangeServer({ body }));
    const at = (name: string) => host.url.replace('sample.bin', name);
    const { app, page } = await run.launch(profile);
    await answerClipboard(app);

    await page.getByRole('button', { name: 'Settings' }).click();
    await turn(page, true);
    await page.getByRole('button', { name: 'Close' }).click();
    await logged(profile, 'clipboard_watch_on', 1);

    await copy(
      app,
      `Here: ${at('archive.zip')}, a page https://example.com/blog/post and ${at('photo.jpg')}`,
    );
    await rowOf(page, 'archive.zip').getByText('Ready', { exact: true }).waitFor();
    expect((await downloadsOf(page)).map((download) => download.fileName)).toEqual(['archive.zip']);

    // A link already in the list is not added again; the new one is.
    await copy(app, `${at('archive.zip')}\n${at('setup.exe')}`);
    await rowOf(page, 'setup.exe').getByText('Ready', { exact: true }).waitFor();
    const ready = await downloadsOf(page);
    expect(ready.map((download) => [download.fileName, download.status])).toEqual([
      ['archive.zip', DownloadStatus.Ready],
      ['setup.exe', DownloadStatus.Ready],
    ]);
    // Nothing was fetched before a Start, and nothing was notified to a person looking at the list.
    expect(host.ranges).toEqual([]);
    expect(await profile.log()).not.toContain('offered_notice_asked');

    await page.getByRole('button', { name: 'Start all' }).click();
    await until(async () =>
      (await downloadsOf(page)).every((download) => download.status === DownloadStatus.Completed),
    );
    for (const name of ['archive.zip', 'setup.exe']) {
      expect(Buffer.compare(await readFile(join(profile.downloads, name)), body)).toBe(0);
    }
    await page.getByRole('button', { name: 'Start all' }).waitFor({ state: 'detached' });

    // Off, nothing is read: a link copied then is not taken, also once it is on again — what is
    // on the clipboard when it is turned on was copied before.
    await page.getByRole('button', { name: 'Settings' }).click();
    await turn(page, false);
    await logged(profile, 'clipboard_watch_off', 1);
    await copy(app, at('while-off.zip'));
    await turn(page, true);
    await page.getByRole('button', { name: 'Close' }).click();
    await logged(profile, 'clipboard_watch_on', 2);
    await copy(app, at('after.zip'));
    await rowOf(page, 'after.zip').getByText('Ready', { exact: true }).waitFor();
    expect((await downloadsOf(page)).map((download) => download.fileName)).toEqual([
      'archive.zip',
      'setup.exe',
      'after.zip',
    ]);

    // Minimised, the window is not in front: the system is asked to say what was added.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });
    await copy(app, `${at('one.zip')} ${at('two.mkv')}`);
    await logged(profile, '"Added 2 links, ready to start"', 0);

    // How many links, never which: what was copied is in no log, main's or the engine's.
    const log = await profile.log();
    expect(log).toContain('clipboard_links_added');
    expect(log).toContain('links_offered');
    expect(log).not.toContain('archive.zip');
    expect(log).not.toContain('blog/post');
  });

  it('sends a copied magnet to a connected AllDebrid at once, and leaves one out with none (#139)', async () => {
    const profile = await run.profile();
    const hash = 'c'.repeat(40);
    const magnet = `magnet:?xt=urn:btih:${hash}&dn=Concert&tr=http://tracker.example/announce`;
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: 4_102_444_800 } },
        hosts: { alldebrid: ['alldebrid.com'] },
        magnets: { [hash]: { name: 'Concert', size: 1, fetchingPolls: 1_000_000, files: [] } },
      }),
    );
    const uploads = () =>
      service.requests.filter((request) => request.url === '/v4/magnet/upload').length;
    const { app, page } = await run.launch(profile, {
      args: [`--alldebrid-api=${service.api}`],
    });
    await answerClipboard(app);
    await page.getByRole('button', { name: 'Settings' }).click();
    await turn(page, true);
    await page.getByRole('button', { name: 'Close' }).click();
    await logged(profile, 'clipboard_watch_on', 0);

    // No service connected: the copy is left out, nothing is sent, and no row is made.
    await copy(app, magnet);
    await logged(profile, 'clipboard_magnets_left_out', 0);
    expect(uploads()).toBe(0);
    expect(await page.getByRole('listitem').count()).toBe(0);

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Use an API key' }).click();
    await page.getByLabel('AllDebrid API key').fill(KEY);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();

    // Connected: copied again — another text, the same magnet — it is sent at once, not left
    // ready, and its tracker is no link of its own.
    await copy(app, `${magnet} `);
    await page.getByRole('listitem').filter({ hasText: 'Concert' }).waitFor();
    await until(() => uploads() === 1);
    expect((await downloadsOf(page)).map((download) => download.url)).toEqual([]);
    const log = await profile.log();
    expect(log).toContain('clipboard_magnets_sent');
    expect(log).not.toContain(hash);
  });
});
