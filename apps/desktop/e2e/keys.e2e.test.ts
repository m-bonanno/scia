import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DownloadStatus, UnlockFailure } from '@scia/core';
import { startAllDebridServer } from '@scia/server/testing/alldebrid-server.ts';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { holdsSealingKey } from '../src/engine/key-vault.ts';
import { downloadsOf, endProcess, paste, rowOf, type Scia, until, useRun } from './scia.ts';

// A key the simulated service was given: made up, as every key of a spec.
const KEY = 'e2e-made-up-key-0123456789';
// Far in the future, in the service's seconds.
const PREMIUM_UNTIL = 4_102_444_800;
const NOT_READ = 'Scia could not read back the key it kept for AllDebrid. Connect it again.';

async function connectByKey(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Use an API key' }).click();
  await page.getByLabel('AllDebrid API key').fill(KEY);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect' }).waitFor();
}

// Killed as the run of #69 killed it: main and every process it started, by force, with no quit.
async function kill(scia: Scia): Promise<void> {
  const main = await scia.app.evaluate(() => process.pid);
  await endProcess(main);
  await scia.exited;
}

// What main said of the keys it kept, and of what opens them: the measure of #69, in CI's record.
function keyLines(log: string): string[] {
  return log
    .split('\n')
    .filter((line) => /key_(kept|seal_prepared|seal_not_prepared|refused)/.test(line));
}

describe('the real app, with a key kept by the system (#69)', () => {
  const run = useRun();

  it('makes what opens a key at the start, on disk seconds later with nothing connected', async () => {
    const profile = await run.profile();
    const launched = performance.now();
    await run.launch(profile);
    // At main's own pace: a file read every few milliseconds is one its writer cannot rename onto
    // (.claude/gotchas.md, Specs).
    const sealOnDisk = async () => {
      // eslint-disable-next-line scia/no-fixed-sleep -- the case itself: a read at main's pace
      await sleep(250);
      return holdsSealingKey(
        await readFile(join(profile.path, 'Local State'), 'utf8').catch(() => ''),
      );
    };

    await until(sealOnDisk);

    const seconds = ((performance.now() - launched) / 1000).toFixed(1);
    console.warn(`#69, the sealing key in Local State ${seconds} s after the launch began`);
    expect(await profile.log()).toContain('key_seal_prepared');
  });

  it.each(['first', 'second', 'third'])(
    'reads back a key connected just before the app was killed, on a new profile (%s run)',
    async () => {
      const profile = await run.profile();
      const service = run.keep(
        await startAllDebridServer({
          accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
        }),
      );
      const args = [`--alldebrid-api=${service.api}`];
      // Connected as soon as the window can: the first start of a profile, when what opens a key
      // may not be on disk yet.
      const first = await run.launch(profile, { args });
      await connectByKey(first.page);
      // Read the moment Scia says it is connected, before the kill.
      const localState = await readFile(join(profile.path, 'Local State'), 'utf8').catch(() => '');

      await kill(first);
      const log = await profile.log();
      // Printed whatever the outcome: a passing run is the record of what was on disk, and when.
      console.warn(`#69, main.log on the keys:\n${keyLines(log).join('\n')}`);
      const again = await run.launch(profile, { args });
      await again.page.getByRole('button', { name: 'Settings' }).click();

      await again.page.getByText(/^Connected as ada/).waitFor();
      expect(await again.page.getByText(NOT_READ).count()).toBe(0);
      expect(holdsSealingKey(localState)).toBe(true);
      expect(log).toContain('key_kept');
      expect(await profile.log()).not.toContain('key_refused');
      expect(await profile.log()).not.toContain(KEY);
    },
  );

  it('says in Settings a key it cannot read, and fetches no link of its hosts as it stands', async () => {
    const profile = await run.profile();
    const host = run.keep(await startRangeServer({ body: Buffer.alloc(64 * 1024, 7) }));
    const link = 'https://hoster.example/file/e2e';
    const another = 'https://hoster.example/file/e2e-another';
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
        hosts: { hoster: ['hoster.example'] },
        links: { [link]: { direct: host.url, filename: 'via-service.bin' } },
      }),
    );
    const args = [`--alldebrid-api=${service.api}`];
    const first = await run.launch(profile, { args });
    await connectByKey(first.page);
    await first.page.getByRole('button', { name: 'Close' }).click();
    // Through the service once: the account's list of hosts is kept for the next start.
    await paste(first.page, link);
    await rowOf(first.page, 'via-service.bin')
      .getByRole('button', { name: 'Show in folder' })
      .waitFor();
    await first.quit();
    // What the system sealed can no longer be opened: as after a profile moved to another account.
    await writeFile(join(profile.path, 'keys', 'alldebrid.key'), 'not sealed by this system');
    // Not even the public list answers: the kept list is what knows the host.
    service.misbehave({ status: 503, route: 'GET /v4/hosts/domains' });

    const again = await run.launch(profile, { args });
    await again.page.getByRole('button', { name: 'Settings' }).click();
    await again.page.getByText(NOT_READ).waitFor();
    await again.page.getByRole('button', { name: 'Close' }).click();
    await paste(again.page, another);

    await until(async () =>
      (await downloadsOf(again.page)).some(
        (download) => download.url === another && download.status === DownloadStatus.Failed,
      ),
    );
    const failed = (await downloadsOf(again.page)).find((download) => download.url === another);
    expect(failed?.failure).toBe(UnlockFailure.NeedsService);
    expect(service.requests.some((request) => request.form.link === another)).toBe(false);
    expect(await profile.log()).toContain('key_not_read');
  });
});
