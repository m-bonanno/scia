import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AllDebridServer,
  startAllDebridServer,
} from '@scia/server/testing/alldebrid-server.ts';
import { type RangeServer, startRangeServer } from '@scia/server/testing/range-server.ts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allCompleted,
  sayWhyItFailed,
  launchScia,
  paste,
  type Profile,
  rowOf,
  type Scia,
  scratchProfile,
  until,
} from './scia.ts';

const KIB = 1024;
// A key the simulated service was given: made up, as every key of a spec.
const KEY = 'e2e-made-up-key-0123456789';
// Far in the future, in the service's seconds.
const PREMIUM_UNTIL = 4_102_444_800;

describe('the real app, with what Settings says', () => {
  let profile: Profile;
  let scia: Scia | undefined;
  let host: RangeServer | undefined;
  let service: AllDebridServer | undefined;

  afterEach(async ({ task }) => {
    await sayWhyItFailed(task, profile);
    await scia?.app.close().catch(() => undefined);
    await host?.close();
    await service?.close();
    await profile.remove();
    scia = undefined;
    host = undefined;
    service = undefined;
  });

  it('holds a download at the speed limit chosen in Settings', async () => {
    profile = await scratchProfile();
    // 1 MB at 256 KB/s is owed four seconds; the host sends as fast as it is read, and without
    // the limit the whole file arrives in well under half a second.
    const body = randomBytes(1024 * KIB);
    host = await startRangeServer({ body });
    scia = await launchScia(profile);
    const { page } = scia;
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('combobox', { name: 'Speed limit' }).selectOption(String(256 * KIB));
    await page.getByRole('button', { name: 'Close' }).click();

    const started = performance.now();
    await paste(page, host.url);
    await until(() => allCompleted(page));

    expect(performance.now() - started).toBeGreaterThan(2000);
    const written = await readFile(join(profile.downloads, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
  });

  it('downloads into the folder chosen in Settings', async () => {
    profile = await scratchProfile();
    const chosen = join(profile.path, 'chosen');
    await mkdir(chosen);
    const body = randomBytes(256 * KIB);
    host = await startRangeServer({ body });
    scia = await launchScia(profile);
    const { page } = scia;
    // The system's dialog is the one thing answered for the person: a script cannot press it.
    await scia.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, chosen);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Change folder' }).click();
    await page.getByText(chosen, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();

    await paste(page, host.url);

    await rowOf(page, 'sample.bin').getByRole('button', { name: 'Show in folder' }).waitFor();
    const written = await readFile(join(chosen, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
  });

  it("unlocks a file host's link through a connected AllDebrid, and downloads it", async () => {
    profile = await scratchProfile();
    const body = randomBytes(512 * KIB);
    host = await startRangeServer({ body });
    const link = 'https://hoster.example/file/e2e';
    service = await startAllDebridServer({
      accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
      hosts: { hoster: ['hoster.example'] },
      links: { [link]: { direct: host.url, filename: 'via-service.bin' } },
    });
    scia = await launchScia(profile, { args: [`--alldebrid-api=${service.api}`] });
    const { page } = scia;
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByLabel('AllDebrid API key').fill(KEY);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByRole('button', { name: 'Disconnect' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();

    await paste(page, link);

    await rowOf(page, 'via-service.bin').getByRole('button', { name: 'Show in folder' }).waitFor();
    const written = await readFile(join(profile.downloads, 'via-service.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
    expect(service.requests.some((request) => request.form.link === link)).toBe(true);
    // The key reached the service, and nowhere a person reads.
    expect(await profile.log()).not.toContain(KEY);
  });
});
