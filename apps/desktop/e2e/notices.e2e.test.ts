import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { Locator, Page } from 'playwright-core';
import { API_PREFIX, ApiErrorCode } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import { NOTICE_MS } from '../../renderer/src/features/notices/notice-limits.ts';
import { allCompleted, paste, rowOf, until, useRun } from './scia.ts';
import {
  bottomOf,
  captureTo,
  placeUnderNotices,
  roomAround,
  scrollsAround,
  scrollToEnd,
  topOfNotices,
  viewportOf,
} from './under-notices.ts';

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

// Settings open, with its rows and its services drawn: before them it is short.
async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByText('Simultaneous downloads').waitFor();
  await settings.getByRole('region', { name: 'Integrations' }).getByText('AllDebrid').waitFor();
  await settings.getByRole('switch', { name: 'Beta versions' }).waitFor();
  return settings;
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

  // The owner, #143: a press of the pointer hands the focus to nothing, and the notices left go in
  // their own time once the pointer has left them.
  it('hands the focus of a notice dismissed with the pointer to nothing', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    const refusals = [ApiErrorCode.NotFound, ApiErrorCode.Conflict];
    let answered = 0;
    await page.route(`**${API_PREFIX}/downloads`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const code = refusals[answered] ?? ApiErrorCode.InternalError;
      answered += 1;
      return route.fulfill({
        status: code === ApiErrorCode.NotFound ? 404 : 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code, message: 'refused' } }),
      });
    });
    const notices = page.getByRole('list', { name: 'Notices' }).getByRole('listitem');
    for (let told = 1; told <= refusals.length; told += 1) {
      await paste(page, 'https://example.com/a.zip');
      await until(async () => (await notices.count()) === told);
    }

    await notices.first().getByRole('button', { name: 'Dismiss' }).click();
    await until(async () => (await notices.count()) === 1);
    const onADismiss = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') === 'Dismiss',
    );
    expect(onADismiss).toBe(false);
    await page.mouse.move(5, 5);
    await until(async () => (await notices.count()) === 0, NOTICE_MS + 5000);
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
  it('leaves room under the end of Settings where it scrolls, and keeps a focus clear of the notices', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    await scia.app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () => Promise.reject(new Error('the system said no'));
    });
    // A window where Settings scrolls: at 720 px it fits on CI's runner (round 1 of #244).
    await scia.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(800, 560);
    });
    await until(() => page.evaluate(() => window.innerHeight === 560));
    const settings = await openSettings(page);
    const sizes = await settings.evaluate((dialog) => ({
      innerHeight: window.innerHeight,
      scrollHeight: dialog.scrollHeight,
      clientHeight: dialog.clientHeight,
    }));
    expect(
      sizes.scrollHeight,
      `Settings does not scroll: ${JSON.stringify(sizes)}`,
    ).toBeGreaterThan(sizes.clientHeight);
    const last = settings.getByRole('switch', { name: 'Beta versions' });

    await settings.getByRole('button', { name: 'Change folder' }).click();
    await settings.getByRole('list', { name: 'Notices' }).getByRole('listitem').waitFor();
    await until(async () => (await roomAround(last)) > 0);

    // A focus the page moves itself, onto a control already in the scrollport, under the notices.
    expect(await placeUnderNotices(last)).toBeGreaterThan(await topOfNotices(page));
    await last.focus();
    expect(await bottomOf(last)).toBeLessThanOrEqual(await topOfNotices(page));
    // The focus Tab moves there, from the control before it.
    await placeUnderNotices(last);
    await last.evaluate((element) => {
      const order = [...document.querySelectorAll<HTMLElement>('dialog button, dialog input')];
      order[order.indexOf(element as HTMLElement) - 1]?.focus();
    });
    await page.keyboard.press('Tab');
    expect(await last.evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await bottomOf(last)).toBeLessThanOrEqual(await topOfNotices(page));
    // Scrolled to its end, the last of it is above them.
    await scrollToEnd(last);
    expect(await bottomOf(settings.getByText(/^Scia \d/))).toBeLessThanOrEqual(
      await topOfNotices(page),
    );
  });

  // The product designer, round 1 of #244: room bought where the notices lie over nothing moved
  // the dialog under the pointer that had just pressed in it.
  it('moves no Settings the notices do not reach, in a tall window', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    await scia.app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () => Promise.reject(new Error('the system said no'));
    });
    await viewportOf(page, 1040, 1000);
    const settings = await openSettings(page);
    const before = await settings.evaluate((dialog) => ({
      top: dialog.getBoundingClientRect().top,
      bottom: dialog.getBoundingClientRect().bottom,
      scrolls: dialog.scrollHeight > dialog.clientHeight,
    }));
    expect(before.scrolls, `Settings scrolls at 1000 px: ${JSON.stringify(before)}`).toBe(false);

    await settings.getByRole('button', { name: 'Change folder' }).click();
    await settings.getByRole('list', { name: 'Notices' }).getByRole('listitem').waitFor();
    // Once the page knows how tall they are, and has drawn what it does with it.
    await until(() =>
      page
        .evaluate(
          () =>
            document.querySelector('[aria-label="Notices"]')?.getBoundingClientRect().height ?? 0,
        )
        .then((height) => height > 0),
    );
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              done();
            });
          });
        }),
    );

    expect(before.bottom).toBeLessThanOrEqual(await topOfNotices(page));
    const after = await settings.evaluate((dialog) => ({
      top: dialog.getBoundingClientRect().top,
      bottom: dialog.getBoundingClientRect().bottom,
      scrolls: dialog.scrollHeight > dialog.clientHeight,
    }));
    expect(after).toEqual(before);
  });

  // Settings measures itself again as its rows arrive and as the window changes size (round 2 of
  // #244): a room taken while it was short, or in another window, would leave its end covered.
  it('keeps the end of Settings clear of a notice shown before it opened', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    await scia.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(800, 560);
    });
    await until(() => page.evaluate(() => window.innerHeight === 560));
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

    const settings = await openSettings(page);
    const version = settings.getByText(/^Scia \d/);
    await until(async () => (await roomAround(version)) > 0);
    await scrollToEnd(version);

    expect(await bottomOf(version)).toBeLessThanOrEqual(await topOfNotices(page));
  });

  it('keeps the end of Settings clear of the notices when the window changes size', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    await scia.app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () => Promise.reject(new Error('the system said no'));
    });
    await viewportOf(page, 1040, 1000);
    const settings = await openSettings(page);
    await settings.getByRole('button', { name: 'Change folder' }).click();
    await settings.getByRole('list', { name: 'Notices' }).getByRole('listitem').waitFor();
    const version = settings.getByText(/^Scia \d/);
    // A tall window: the notices reach nothing of it, and it keeps no room.
    expect(await bottomOf(version)).toBeLessThanOrEqual(await topOfNotices(page));
    expect(await roomAround(version)).toBe(0);

    await viewportOf(page, 1040, 560);
    await until(async () => (await roomAround(version)) > 0);
    await scrollToEnd(version);

    expect(await bottomOf(version)).toBeLessThanOrEqual(await topOfNotices(page));
  });

  // The captures #143 asks for, taken from the real app by CI (the owner, on #143): a change the
  // engine failed to keep, Settings scrolled to its end — at 800 px, dark and light, and at 720.
  it('takes the captures of a notice over Settings', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    await page.route(`**${API_PREFIX}/settings`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: ApiErrorCode.InternalError, message: 'refused' } }),
      });
    });
    const shots = [
      { height: 800, variant: 'dark', name: 'a-notice-over-settings.png' },
      { height: 800, variant: 'light', name: 'a-notice-over-settings-light.png' },
      { height: 720, variant: 'dark', name: 'a-notice-over-settings-720.png' },
    ] as const;
    for (const { height, variant, name } of shots) {
      await scia.app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, variant);
      await viewportOf(page, 1040, height);
      const settings = await openSettings(page);
      await settings.getByRole('button', { name: 'Increase' }).first().click();
      const notice = settings.getByRole('list', { name: 'Notices' }).getByRole('listitem');
      await notice.waitFor();
      // Nothing under the pointer, scrolled to the end, and every transition over (a hover's
      // colour going back included) before the capture.
      await page.mouse.move(1, 1);
      await scrollToEnd(settings.getByText(/^Scia \d/));
      await until(() =>
        page.evaluate(
          (wanted) =>
            matchMedia(`(prefers-color-scheme: ${wanted})`).matches &&
            document.getAnimations().length === 0,
          variant,
        ),
      );
      expect(await bottomOf(settings.getByText(/^Scia \d/))).toBeLessThanOrEqual(
        await topOfNotices(page),
      );
      await page.screenshot({ path: await captureTo(name) });
      await settings.getByRole('button', { name: 'Close' }).click();
      await settings.waitFor({ state: 'hidden' });
    }
  });

  // The tech lead, round 2 of #244: a focus scrolled clear of the notices at the pointer's press
  // moved the button before it was let go, and the click was lost.
  it('takes a press of the pointer on a control beside the notices, in the room under them', async () => {
    const profile = await run.profile();
    const host = run.keep(await startRangeServer({ body: randomBytes(64 * 1024) }));
    const scia = await run.launch(profile);
    const { page } = scia;
    // Wide enough for a row's buttons to lie beside the notices, which are centred and narrower.
    await scia.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1000, 700);
    });
    await until(() =>
      page.evaluate(() => window.innerWidth === 1000 && window.innerHeight === 700),
    );
    const links = Array.from({ length: 12 }, (_, n) => `${host.url}?copy=${String(n)}`);
    await paste(page, links.join(' '));
    await until(() => allCompleted(page));
    const rows = page.getByRole('main').getByRole('listitem');
    await until(async () => (await rows.count()) === 12);
    const lastRow = rows.last();
    await page.route(`**${API_PREFIX}/downloads`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: ApiErrorCode.InternalError, message: 'refused' } }),
      });
    });
    await paste(page, 'https://example.com/a.zip');
    const notice = page.getByRole('list', { name: 'Notices' }).getByRole('listitem');
    await notice.waitFor();
    await until(async () => (await roomAround(lastRow)) > 0);
    const remove = lastRow.getByRole('button', { name: 'Remove from list' });
    expect(await placeUnderNotices(remove)).toBeGreaterThan(await topOfNotices(page));
    const button = await remove.boundingBox();
    const beside = await notice.first().boundingBox();
    expect(button !== null && beside !== null && button.x > beside.x + beside.width).toBe(true);

    await page.mouse.click((button?.x ?? 0) + (button?.width ?? 0) / 2, (button?.y ?? 0) + 10);

    await until(async () => (await rows.count()) === 11);
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
    expect(await scrollsAround(lastRow)).toBe(true);
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
    await until(async () => (await roomAround(lastRow)) > 0);
    const lastButton = lastRow.getByRole('button').last();

    // A focus the page moves itself, onto a control already in the scrollport, under the notices.
    expect(await placeUnderNotices(lastButton)).toBeGreaterThan(await topOfNotices(page));
    await lastButton.focus();
    expect(await bottomOf(lastButton)).toBeLessThanOrEqual(await topOfNotices(page));
    // Scrolled to its end, the last row is above them.
    await scrollToEnd(lastRow);
    expect(await bottomOf(lastRow)).toBeLessThanOrEqual(await topOfNotices(page));
  });
});
