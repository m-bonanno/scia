import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { Locator, Page } from 'playwright-core';
import { API_PREFIX, ApiErrorCode } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import { NOTICE_MS } from '../../renderer/src/features/notices/notice-limits.ts';
import { allCompleted, paste, rowOf, until, useRun } from './scia.ts';

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

// Where the notices begin: what is drawn below it lies under them.
async function topOfNotices(page: Page): Promise<number> {
  return page
    .getByRole('list', { name: 'Notices' })
    .getByRole('listitem')
    .first()
    .evaluate((item) => item.getBoundingClientRect().top);
}

async function bottomOf(thing: Locator): Promise<number> {
  return thing.evaluate((element) => element.getBoundingClientRect().bottom);
}

// The room an area that scrolls beneath the notices keeps under its end, once the page knows how
// tall they are.
async function roomUnder(area: Locator): Promise<number> {
  return area.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
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
    await until(async () => (await notices.count()) === 0);
  });

  it('stays while the pointer is on it, and goes once the pointer has left', async () => {
    const profile = await run.profile();
    const host = run.keep(await startRangeServer({ body: randomBytes(64 * 1024) }));
    const scia = await run.launch(profile);
    const { page } = scia;
    await paste(page, host.url);
    const row = rowOf(page, 'sample.bin');
    await row.getByRole('button', { name: 'Show in folder' }).waitFor({ timeout: 30_000 });
    await rm(join(profile.downloads, 'sample.bin'));
    await row.getByRole('button', { name: 'Open' }).click();
    const notice = page.getByRole('list', { name: 'Notices' }).getByRole('listitem');
    await notice.waitFor();

    await notice.hover();
    const held = performance.now();
    // What is proven is a time: past the one a notice nobody holds is shown, by more than a second.
    await until(() => performance.now() - held > NOTICE_MS + 1500, NOTICE_MS + 5000);
    expect(await notice.count()).toBe(1);

    await page.mouse.move(5, 5);
    await until(async () => (await notice.count()) === 0, NOTICE_MS + 5000);
  });

  it('hands the focus of a notice pushed out by a newer one to the one now in its place', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    // Four adds the engine refuses, each for a reason of its own, so that each is a notice; the
    // fourth is answered once the focus is on the oldest notice.
    const refusals = [
      { status: 401, code: ApiErrorCode.Unauthorized },
      { status: 404, code: ApiErrorCode.NotFound },
      { status: 409, code: ApiErrorCode.Conflict },
      { status: 500, code: ApiErrorCode.InternalError },
    ];
    let answered = 0;
    let focusPlaced: () => void = () => undefined;
    const placed = new Promise<void>((done) => {
      focusPlaced = done;
    });
    await page.route(`**${API_PREFIX}/downloads`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const refusal = refusals[answered];
      answered += 1;
      if (answered === refusals.length) await placed;
      return route.fulfill({
        status: refusal?.status ?? 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: refusal?.code, message: 'refused' } }),
      });
    });
    const notices = page.getByRole('list', { name: 'Notices' }).getByRole('listitem');
    await page
      .getByRole('textbox', { name: 'Links to download' })
      .fill('https://example.com/a.zip');
    const download = page.getByRole('button', { name: 'Download' });
    for (let told = 1; told < refusals.length; told += 1) {
      await download.click();
      await until(async () => (await notices.count()) === told);
    }
    const oldest = await notices.first().textContent();

    await download.click();
    await notices.first().getByRole('button', { name: 'Dismiss' }).focus();
    focusPlaced();
    await until(async () => (await notices.first().textContent()) !== oldest);

    expect(await notices.count()).toBe(refusals.length - 1);
    const focused = await page.evaluate(() => {
      const active = document.activeElement;
      const first = document.querySelector('[aria-label="Notices"] li');
      return active?.getAttribute('aria-label') === 'Dismiss' && (first?.contains(active) ?? false);
    });
    expect(focused).toBe(true);
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
    await until(async () => (await notice.count()) === 0);
    expect(await settings.isVisible()).toBe(true);
  });

  // WCAG 2.2, 2.4.11: a control that takes the focus is not hidden under the notices (#143).
  it('leaves room under the end of Settings, at the window’s own height, as tall as the notices', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    await scia.app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () => Promise.reject(new Error('the system said no'));
    });
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    const last = settings.getByRole('switch', { name: 'Beta versions' });
    await last.waitFor();
    // At 720 px Settings scrolls: its last setting starts out of sight.
    expect(await settings.evaluate((dialog) => dialog.scrollHeight > dialog.clientHeight)).toBe(
      true,
    );

    await settings.getByRole('button', { name: 'Change folder' }).click();
    await settings.getByRole('list', { name: 'Notices' }).getByRole('listitem').waitFor();
    await until(async () => (await roomUnder(settings)) > 0);
    await last.focus();

    expect(await bottomOf(last)).toBeLessThanOrEqual(await topOfNotices(page));
    await settings.evaluate((dialog) => {
      dialog.scrollTop = dialog.scrollHeight;
    });
    const version = settings.getByText(/^Scia \d/);
    expect(await bottomOf(version)).toBeLessThanOrEqual(await topOfNotices(page));
  });

  it('leaves room under the last row of the list, as tall as the notices', async () => {
    const profile = await run.profile();
    const host = run.keep(await startRangeServer({ body: randomBytes(64 * 1024) }));
    const scia = await run.launch(profile);
    const { page } = scia;
    // Rows enough for the list to scroll at the window's own size.
    const links = Array.from({ length: 12 }, (_, n) => `${host.url}?copy=${String(n)}`);
    await paste(page, links.join(' '));
    await until(() => allCompleted(page));
    const rows = page.getByRole('main').getByRole('listitem');
    await until(async () => (await rows.count()) === 12);
    const lastRow = rows.last();
    const list = page.getByRole('main').locator('.overflow-y-auto');
    expect(await list.evaluate((area) => area.scrollHeight > area.clientHeight)).toBe(true);
    await page.route(`**${API_PREFIX}/downloads`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: ApiErrorCode.InternalError, message: 'refused' } }),
      });
    });

    await paste(page, 'https://example.com/a.zip');
    await page.getByRole('list', { name: 'Notices' }).getByRole('listitem').waitFor();
    await until(async () => (await roomUnder(list)) > 0);
    const lastButton = lastRow.getByRole('button').last();
    await lastButton.focus();

    expect(await bottomOf(lastButton)).toBeLessThanOrEqual(await topOfNotices(page));
    await list.evaluate((area) => {
      area.scrollTop = area.scrollHeight;
    });
    expect(await bottomOf(lastRow)).toBeLessThanOrEqual(await topOfNotices(page));
  });
});
