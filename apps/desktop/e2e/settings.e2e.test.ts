import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startAllDebridServer } from '@scia/server/testing/alldebrid-server.ts';
import { startRangeServer } from '@scia/server/testing/range-server.ts';
import type { ElectronApplication } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { allCompleted, paste, rowOf, until, useRun } from './scia.ts';
import { captureTo, viewportOf } from './under-notices.ts';

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
    await page.getByRole('button', { name: 'Change folder' }).click();
    await page.getByText(chosen, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();

    await paste(page, host.url);

    await rowOf(page, 'sample.bin').getByRole('button', { name: 'Show in folder' }).waitFor();
    const written = await readFile(join(chosen, 'sample.bin'));
    expect(Buffer.compare(written, body)).toBe(0);
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
    // An address handed over the bridge by the page is not what main opens.
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

  // The two captures of the whole dialog, taken from the real app by CI (#271), as #143 took those
  // of a notice over Settings: 1040 by 900, AllDebrid connected, the clipboard's links on, the
  // betas off, dark and light.
  it('takes the captures of Settings', async () => {
    const profile = await run.profile();
    const service = run.keep(
      await startAllDebridServer({
        accounts: { [KEY]: { username: 'ada', premiumUntil: PREMIUM_UNTIL } },
      }),
    );
    const scia = await run.launch(profile, { args: [`--alldebrid-api=${service.api}`] });
    const { page } = scia;
    // The runner's own clipboard is not read: main is answered an empty one.
    await scia.app.evaluate(({ clipboard }) => {
      clipboard.readText = () => Promise.resolve('');
    });
    await viewportOf(page, 1040, 900);
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Use an API key' }).click();
    await settings.getByLabel('AllDebrid API key').fill(KEY);
    await settings.getByRole('button', { name: 'Connect', exact: true }).click();
    await settings.getByText(/^Connected as ada/).waitFor();
    const watch = settings.getByRole('switch', { name: 'Take links from the clipboard' });
    await watch.click();
    await until(() => watch.isChecked());
    const betas = settings.getByRole('switch', { name: 'Beta versions' });
    expect(await betas.isChecked()).toBe(false);

    for (const { variant, name } of [
      { variant: 'dark', name: 'settings.png' },
      { variant: 'light', name: 'settings-light.png' },
    ] as const) {
      await scia.app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, variant);
      // Nothing under the pointer, no focus drawn, and every transition over before the capture.
      await page.mouse.move(1, 1);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      await until(() =>
        page.evaluate(
          (wanted) =>
            matchMedia(`(prefers-color-scheme: ${wanted})`).matches &&
            document.getAnimations().length === 0,
          variant,
        ),
      );
      // The whole dialog shows: it does not scroll, and its last line is in the window.
      const { scrolls, bottom } = await settings.evaluate((dialog) => ({
        scrolls: dialog.scrollHeight > dialog.clientHeight,
        bottom: dialog.getBoundingClientRect().bottom,
      }));
      expect(scrolls, `${name}: Settings scrolls at 900 px`).toBe(false);
      expect(bottom).toBeLessThanOrEqual(900);
      await settings.getByRole('button', { name: 'Support Scia' }).waitFor();
      await page.screenshot({ path: await captureTo(name) });
    }
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

async function openedBy(scia: { readonly app: ElectronApplication }): Promise<string[]> {
  return scia.app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
}
