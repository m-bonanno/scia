import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { startAllDebridServer } from '@scia/server/testing/alldebrid-server.ts';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { ElectronApplication, Locator } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { allCompleted, paste, rowOf, until, useRun } from './scia.ts';
import { captureTo, scrollToEnd, viewportOf } from './under-notices.ts';

const KIB = 1024;
// A key the simulated service was given: made up, as every key of a spec.
const KEY = 'e2e-made-up-key-0123456789';
// Far in the future, in the service's seconds.
const PREMIUM_UNTIL = 4_102_444_800;

describe('the real app, with what Settings says', () => {
  const run = useRun();

  it('holds a download at the speed limit chosen in Settings', async () => {
    const profile = await run.profile();
    // 2 MB at 256 KB/s is owed eight seconds, counted from the host's first range, past the probe
    // of the first byte and whatever is asked of a service. The host sends as fast as it is read:
    // without the limit the file arrives in well under a second, at twice the limit in four.
    const body = randomBytes(2048 * KIB);
    const host = run.keep(await startRangeServer({ body }));
    const scia = await run.launch(profile);
    const { page } = scia;
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('combobox', { name: 'Speed limit' }).selectOption(String(256 * KIB));
    await page.getByRole('button', { name: 'Close' }).click();

    await paste(page, host.url);
    await until(() => host.ranges.some((range) => range !== undefined && range !== 'bytes=0-0'));
    const started = performance.now();
    await until(() => allCompleted(page));

    expect(performance.now() - started).toBeGreaterThan(6000);
    const written = await readFile(join(profile.downloads, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
  });

  it('downloads into the folder chosen in Settings', async () => {
    const profile = await run.profile();
    const chosen = join(profile.path, 'chosen');
    await mkdir(chosen);
    const body = randomBytes(256 * KIB);
    const host = run.keep(await startRangeServer({ body }));
    const scia = await run.launch(profile);
    const { page } = scia;
    // The system's dialog is the one thing answered for the person: a script cannot press it.
    await scia.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, chosen);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Change…' }).click();
    await page.getByText(chosen, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();

    await paste(page, host.url);

    await rowOf(page, 'sample.bin').getByRole('button', { name: 'Show in folder' }).waitFor();
    const written = await readFile(join(chosen, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
  });

  // #40: a long path was cut at its end, which hid the name just chosen; and "Change…" is in words,
  // in the middle of the label and the path beside it.
  it("cuts a long folder's path at its start, so that the name just chosen shows beside Change…", async () => {
    const profile = await run.profile();
    // Ending in a neutral character, which a right-to-left box would move to its left end were the
    // path not kept in its own order (the frontend engineer, round 1 of #278).
    const name = 'Films chosen last_';
    const chosen = join(
      profile.path,
      'a-folder-whose-name-is-long-enough-to-be-cut',
      'and-another-one-as-long-as-the-first-of-them',
      name,
    );
    await mkdir(chosen, { recursive: true });
    const scia = await run.launch(profile);
    const { page } = scia;
    await scia.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, chosen);
    await page.getByRole('button', { name: 'Settings' }).click();
    const change = page.getByRole('button', { name: 'Change…' });
    await change.click();
    const path = page.getByText(chosen, { exact: true });
    await path.waitFor();

    const seen = await path.evaluate((element, end) => {
      const box = element.closest('output');
      const text = element.firstChild;
      if (box === null || text === null) throw new Error('No path in its box.');
      const length = text.textContent?.length ?? 0;
      const rectOf = (from: number, to: number) => {
        const range = document.createRange();
        range.setStart(text, from);
        range.setEnd(text, to);
        return range.getBoundingClientRect();
      };
      const shown = box.getBoundingClientRect();
      const last = rectOf(length - end.length, length);
      return {
        cut: box.scrollWidth > box.clientWidth,
        box: { left: shown.left, right: shown.right },
        first: rectOf(0, 1).left,
        name: { left: last.left, right: last.right },
      };
    }, name);
    // The premise: the path is longer than its box.
    expect(seen.cut, JSON.stringify(seen)).toBe(true);
    expect(seen.first, JSON.stringify(seen)).toBeLessThan(seen.box.left);
    expect(seen.name.left, JSON.stringify(seen)).toBeGreaterThanOrEqual(seen.box.left);
    expect(seen.name.right, JSON.stringify(seen)).toBeLessThanOrEqual(seen.box.right + 0.5);
    // A button of words, in the middle of the label and the path.
    expect(await change.textContent()).toBe('Change…');
    const top = await placeOf(page.getByText('Download folder', { exact: true }), 'top');
    const bottom = await placeOf(page.locator('output', { has: path }), 'bottom');
    expect(Math.abs((await placeOf(change, 'middle')) - (top + bottom) / 2)).toBeLessThanOrEqual(1);
  });

  // The common case: a path that fits is not cut, and starts under its label. Written right to
  // left, its box would lay it against "Change…" but for `text-left` (round 1 of #278).
  it("starts a folder's path that fits at the left edge of its label, uncut", async () => {
    const profile = await run.profile();
    // At the drive's root, where the path is short whatever the runner's profile is called.
    const chosen = await mkdtemp(join(parse(tmpdir()).root, 'scia-e2e-'));
    run.keep({ close: () => rm(chosen, { recursive: true, force: true }) });
    const scia = await run.launch(profile);
    const { page } = scia;
    await scia.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, chosen);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Change…' }).click();
    const path = page.getByText(chosen, { exact: true });
    await path.waitFor();

    const seen = await path.evaluate((element) => {
      const box = element.closest('output');
      if (box === null) throw new Error('No path in its box.');
      return {
        cut: box.scrollWidth > box.clientWidth,
        path: element.getBoundingClientRect().left,
      };
    });
    const label = await page
      .getByText('Download folder', { exact: true })
      .evaluate((element) => element.getBoundingClientRect().left);
    // The premise: the path fits its box.
    expect(seen.cut, JSON.stringify({ ...seen, label })).toBe(false);
    expect(Math.abs(seen.path - label), JSON.stringify({ ...seen, label })).toBeLessThanOrEqual(1);
  });

  // The captures of docs/design/ that show Settings, taken from the built app by CI (the owner's
  // decision on #143), retaken for #40's "Change…": AllDebrid not connected, a key it refused, a
  // code to confirm in both variants, and the whole dialog, AllDebrid connected, in both.
  it('takes the captures of Settings', async () => {
    const profile = await run.profile();
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
      }),
    );
    const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
    const { page } = scia;
    // The clipboard is answered in main, empty, as clipboard.e2e answers it: nothing of the
    // runner's is read, its formats included (#277).
    await scia.app.evaluate(({ clipboard }) => {
      clipboard.readText = () => Promise.resolve('');
      clipboard.has = () => Promise.resolve(false);
    });
    const settings = page.getByRole('dialog', { name: 'Settings' });
    const integrations = settings.getByRole('region', { name: 'Integrations' });
    const capture = async (name: string, variant: 'dark' | 'light') => {
      await scia.app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, variant);
      // Nothing under the pointer, and every transition over before the capture.
      await page.mouse.move(1, 1);
      await until(() =>
        page.evaluate(
          (wanted) =>
            matchMedia(`(prefers-color-scheme: ${wanted})`).matches &&
            document.getAnimations().length === 0,
          variant,
        ),
      );
      await page.screenshot({ path: await captureTo(name) });
    };

    await viewportOf(page, 1040, 720);
    await page.getByRole('button', { name: 'Settings' }).click();
    await integrations.getByRole('button', { name: 'Connect with a code' }).waitFor();
    await settings.getByRole('switch', { name: 'Beta versions' }).waitFor();
    await capture('two-ways-to-connect.png', 'dark');

    await integrations.getByRole('button', { name: 'Use an API key' }).click();
    await settings.getByLabel('AllDebrid API key').fill('e2e-a-key-the-service-does-not-know');
    await settings.getByRole('button', { name: 'Connect', exact: true }).click();
    await settings.getByText(/^AllDebrid does not know this key/).waitFor();
    await scrollToEnd(settings.getByText(/^Scia \d/));
    await capture('connect-a-service.png', 'dark');
    await settings.getByRole('button', { name: 'Cancel' }).click();

    // Pressed with the keyboard, as the focus it hands to "Open AllDebrid" is drawn.
    await integrations.getByRole('button', { name: 'Connect with a code' }).press('Enter');
    const open = integrations.getByRole('button', { name: 'Open AllDebrid' });
    await until(() => open.evaluate((element) => element === document.activeElement));
    await capture('connect-with-a-code.png', 'dark');
    await capture('connect-with-a-code-light.png', 'light');
    await integrations.getByRole('button', { name: 'Cancel' }).click();

    await integrations.getByRole('button', { name: 'Use an API key' }).click();
    await settings.getByLabel('AllDebrid API key').fill(KEY);
    await settings.getByRole('button', { name: 'Connect', exact: true }).click();
    await integrations.getByRole('button', { name: 'Disconnect' }).waitFor();
    const clipboard = settings.getByRole('switch', { name: 'Take links from the clipboard' });
    await clipboard.click();
    // What the engine kept: the switch is checked once its answer is drawn.
    await until(() => clipboard.isChecked());
    await settings.getByRole('button', { name: 'Close' }).click();
    await settings.waitFor({ state: 'hidden' });
    await viewportOf(page, 1040, 900);
    await page.getByRole('button', { name: 'Settings' }).click();
    await integrations.getByText(/^Connected as ada/).waitFor();
    await capture('settings.png', 'dark');
    await capture('settings-light.png', 'light');
  });

  it("unlocks a file host's link through a connected AllDebrid, and downloads it", async () => {
    const profile = await run.profile();
    const body = randomBytes(512 * KIB);
    const host = run.keep(await startRangeServer({ body }));
    const link = 'https://hoster.example/file/e2e';
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
        hosts: { hoster: ['hoster.example'] },
        links: { [link]: { direct: host.url, filename: 'via-service.bin' } },
      }),
    );
    const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
    const { page } = scia;
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Use an API key' }).click();
    await page.getByLabel('AllDebrid API key').fill(KEY);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
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
  // WCAG 2.2, 1.4.11: at rest and empty, the key's field is drawn by its placeholder alone —
  // its boundary is held to no ratio — so the placeholder is held at the contrast of text (#66).
  it("draws the key's field at rest with a placeholder at the contrast of text", async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Use an API key' }).click();
    const field = page.getByLabel('AllDebrid API key');

    expect(await field.getAttribute('placeholder')).toBe('Paste your API key');
    expect(await field.inputValue()).toBe('');
    // In both variants, chosen in main as a system would choose them (#155), not the runner's.
    for (const variant of ['light', 'dark'] as const) {
      await scia.app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, variant);
      await until(() =>
        page.evaluate(
          (wanted) =>
            matchMedia(`(prefers-color-scheme: ${wanted})`).matches &&
            document.getAnimations().length === 0,
          variant,
        ),
      );
      const { placeholder, ground } = await field.evaluate((element) => ({
        placeholder: getComputedStyle(element, '::placeholder').color,
        ground: getComputedStyle(element.closest('dialog') ?? element).backgroundColor,
      }));
      expect(contrast(placeholder, ground), variant).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('connects AllDebrid with a code confirmed on its site, whose page main opens', async () => {
    const profile = await run.profile();
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
      }),
    );
    const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
    const { page } = scia;
    // The person's browser is answered in main, as the folder dialog is: what main would open is
    // written down instead.
    await scia.app.evaluate(({ shell }) => {
      const opened: string[] = [];
      Object.assign(globalThis, { opened });
      shell.openExternal = (url) => {
        opened.push(url);
        return Promise.resolve();
      };
    });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Connect with a code' }).click();
    await page.getByRole('button', { name: 'Open AllDebrid' }).click();

    const asked = service.requests.find((request) => request.url === '/v4.1/pin/get');
    expect(asked?.authorization).toBeUndefined();
    const code = (await page.locator('p.font-mono').textContent()) ?? '';
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    await until(async () => (await openedBy(scia)).length > 0);
    expect(await openedBy(scia)).toEqual([`https://alldebrid.com/pin/?pin=${code}`]);

    service.confirmCode(code, KEY);

    await page.getByRole('button', { name: 'Disconnect' }).waitFor();
    await page.getByText(/^Connected as ada/).waitFor();
    // The key reached Scia from the service alone, and nowhere a person reads.
    expect(await profile.log()).not.toContain(KEY);
  });

  // The owner, #146: with Settings closed before the code is confirmed, Scia keeps waiting for it
  // and connects when it is confirmed, saying so by the system while nobody looks at the window.
  async function codeLeftWaiting(scia: Awaited<ReturnType<typeof run.launch>>): Promise<string> {
    const { page } = scia;
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Connect with a code' }).click();
    const code = (await page.locator('p.font-mono').textContent()) ?? '';
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'hidden' });
    return code;
  }

  it('connects a code confirmed once Settings closed, and the system says so while the window is minimised', async () => {
    const profile = await run.profile();
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
      }),
    );
    const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
    const code = await codeLeftWaiting(scia);
    await scia.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });

    service.confirmCode(code, KEY);

    await until(async () => (await profile.log()).includes('connected_notice_asked'));
    expect(await profile.log()).toMatch(/connected_notice_asked {[^}]*'AllDebrid is connected'/);
    await scia.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.restore();
    });
    // The page heard it in the engine's events: the account's magnets are offered.
    await scia.page.getByRole('button', { name: 'AllDebrid magnets' }).waitFor();
    await scia.page.getByRole('button', { name: 'Settings' }).click();
    await scia.page.getByText(/^Connected as ada/).waitFor();
    expect(await profile.log()).not.toContain(KEY);
  });

  it('connects a code confirmed once Settings closed, said by no notification while the window is in front, and shows the code again meanwhile', async () => {
    const profile = await run.profile();
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
      }),
    );
    const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
    const { page } = scia;
    const code = await codeLeftWaiting(scia);

    // Opened again before it is confirmed, Settings shows the code the engine still waits for.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('p.font-mono', { hasText: code }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'hidden' });

    service.confirmCode(code, KEY);

    await page.getByRole('button', { name: 'AllDebrid magnets' }).waitFor();
    await until(async () => (await profile.log()).includes('service_connected_heard'));
    const log = await profile.log();
    // Windows itself said which window was in use, inside the built app (ADR 0020).
    expect(log).toMatch(/service_connected_heard {[^}]*inFront: true[^}]*asked: 'answered'/);
    expect(log).not.toContain('connected_notice_asked');
  });

  it('offers a way to support Scia, whose page main opens at its fixed address (#271)', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    await scia.app.evaluate(({ shell }) => {
      const opened: string[] = [];
      Object.assign(globalThis, { opened });
      shell.openExternal = (url) => {
        opened.push(url);
        return Promise.resolve();
      };
    });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Support Scia' }).click();
    await until(async () => (await openedBy(scia)).length > 0);
    // An address handed over the bridge by the page is not what main opens: the preload drops it,
    // and main reads nothing that comes with the ask (support-page.test.ts holds main's half).
    await page.evaluate(() =>
      (
        window as unknown as { scia: { openSupportPage: (url: string) => Promise<unknown> } }
      ).scia.openSupportPage('https://elsewhere.example/'),
    );

    expect(await openedBy(scia)).toEqual([
      'https://ko-fi.com/notsosnake',
      'https://ko-fi.com/notsosnake',
    ]);
  });
});

// The ratio of WCAG 2.2 between two opaque colours as the page computes them, `rgb(r, g, b)`.
// Anything else — a colour with an alpha, `oklab(…)` — is refused, not read as three channels.
function contrast(one: string, other: string): number {
  const luminance = (colour: string) => {
    expect(colour).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    const [red = 0, green = 0, blue = 0] = (colour.match(/\d+(\.\d+)?/g) ?? [])
      .slice(0, 3)
      .map((channel) => Number(channel) / 255)
      .map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter = 0, darker = 0] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// Where a thing begins, ends or has its middle on the page, counted from its top.
async function placeOf(thing: Locator, where: 'top' | 'middle' | 'bottom'): Promise<number> {
  return thing.evaluate((element, at) => {
    const { top, bottom } = element.getBoundingClientRect();
    if (at === 'top') return top;
    return at === 'bottom' ? bottom : (top + bottom) / 2;
  }, where);
}

async function openedBy(scia: { readonly app: ElectronApplication }): Promise<string[]> {
  return scia.app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
}
