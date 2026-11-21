import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { Locator } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { paste, rowOf, until, useRun } from './scia.ts';

const NOT_OPENED = 'Scia could not open the file. It may have been moved or deleted.';

// What is drawn at the middle of the notice is the notice: nothing covers it, and it covers
// whatever it lies on — a dialog's backdrop included.
async function isOnTop(notice: Locator): Promise<boolean> {
  return notice.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && element.contains(hit);
  });
}

describe('the real app says what went wrong in a notice', () => {
  const run = useRun();

  it('at the bottom of the window, which goes by itself, or at once when dismissed', async () => {
    const profile = await run.profile();
    const host = run.keep(await startRangeServer({ body: randomBytes(64 * 1024) }));
    const scia = await run.launch(profile);
    const { page } = scia;
    await paste(page, host.url);
    const row = rowOf(page, 'sample.bin');
    await row.getByRole('button', { name: 'Show in folder' }).waitFor({ timeout: 30_000 });
    await rm(join(profile.downloads, 'sample.bin'));
    const notices = page.getByRole('list', { name: 'Notices' });

    await row.getByRole('button', { name: 'Open' }).click();

    const notice = notices.getByRole('listitem').filter({ hasText: NOT_OPENED });
    await notice.waitFor();
    expect(await isOnTop(notice)).toBe(true);
    const box = await notice.boundingBox();
    const viewport = await page.evaluate(() => window.innerHeight);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(viewport - 48);
    await until(async () => (await notices.count()) === 0, 15_000);

    await row.getByRole('button', { name: 'Open' }).click();
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    expect(await notices.count()).toBe(0);
  });

  it('over Settings while it is open, where it can be dismissed', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    // The system's dialog fails, which a script can make it do: main answers the page with a
    // failure that is not about a folder.
    await scia.app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () => Promise.reject(new Error('the system said no'));
    });
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });

    await settings.getByRole('button', { name: 'Change folder' }).click();

    const notice = settings.getByRole('list', { name: 'Notices' }).getByRole('listitem');
    await notice.waitFor();
    expect(await isOnTop(notice)).toBe(true);
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    expect(await notice.count()).toBe(0);
    expect(await settings.isVisible()).toBe(true);
  });
});
