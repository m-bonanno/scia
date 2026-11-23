import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { until } from './scia.ts';

// Where the notices begin: what is drawn below it lies under them.
export async function topOfNotices(page: Page): Promise<number> {
  return page
    .getByRole('list', { name: 'Notices' })
    .getByRole('listitem')
    .first()
    .evaluate((item) => item.getBoundingClientRect().top);
}

export async function bottomOf(thing: Locator): Promise<number> {
  return thing.evaluate((element) => element.getBoundingClientRect().bottom);
}

// The room the area that scrolls around a thing keeps under its end, once the page knows how tall
// the notices are.
export async function roomAround(thing: Locator): Promise<number> {
  return thing.evaluate((element) => {
    let area = element.parentElement;
    while (area !== null && !['auto', 'scroll'].includes(getComputedStyle(area).overflowY)) {
      area = area.parentElement;
    }
    return area === null ? 0 : Number.parseFloat(getComputedStyle(area).paddingBottom);
  });
}

// Whether the area around a thing has more than it shows.
export async function scrollsAround(thing: Locator): Promise<boolean> {
  return thing.evaluate((element) => {
    let area = element.parentElement;
    while (area !== null && !['auto', 'scroll'].includes(getComputedStyle(area).overflowY)) {
      area = area.parentElement;
    }
    return area !== null && area.scrollHeight > area.clientHeight;
  });
}

// Scrolls the area around a control so that it lies under the notices, still inside the area —
// where Chromium does not scroll a focus the page moves there by itself — and says where it ends.
export async function placeUnderNotices(control: Locator): Promise<number> {
  const top = await topOfNotices(control.page());
  return control.evaluate((element, noticesTop) => {
    let area = element.parentElement;
    while (area !== null && !['auto', 'scroll'].includes(getComputedStyle(area).overflowY)) {
      area = area.parentElement;
    }
    if (area !== null) area.scrollTop -= noticesTop + 10 - element.getBoundingClientRect().bottom;
    return element.getBoundingClientRect().bottom;
  }, top);
}

// Scrolls the area around a thing to its end.
export async function scrollToEnd(thing: Locator): Promise<void> {
  await thing.evaluate((element) => {
    let area: Element | null = element;
    while (area !== null && !['auto', 'scroll'].includes(getComputedStyle(area).overflowY)) {
      area = area.parentElement;
    }
    if (area !== null) area.scrollTop = area.scrollHeight;
  });
}

// The page given a viewport of its own over the DevTools protocol, as the window of a screen
// that size would give it: a runner's screen may be smaller than the window a spec needs.
export async function viewportOf(page: Page, width: number, height: number): Promise<void> {
  const protocol = await page.context().newCDPSession(page);
  await protocol.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(() =>
    page.evaluate(([w, h]) => window.innerWidth === w && window.innerHeight === h, [
      width,
      height,
    ] as const),
  );
}

// Where the captures of a run go: the E2E job uploads the folder it names (gates.yml).
export async function captureTo(name: string): Promise<string> {
  const folder = process.env.SCIA_CAPTURES ?? join(tmpdir(), 'scia-captures');
  await mkdir(folder, { recursive: true });
  return join(folder, name);
}
