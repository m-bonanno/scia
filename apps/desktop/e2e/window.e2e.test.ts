import { ColourScheme, DEFAULT_THEME, Theme, WINDOW_COLOURS } from '@scia/contracts/theme';
import type { ElectronApplication, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { until, useRun } from './scia.ts';

// The variant Electron would take from the system, set as the system would set it: the page's
// `prefers-color-scheme` and main's `nativeTheme` both follow it.
async function systemAsks(app: ElectronApplication, scheme: ColourScheme): Promise<void> {
  await app.evaluate(({ nativeTheme }, source) => {
    nativeTheme.themeSource = source;
  }, scheme);
}

const pageWears = (page: Page) =>
  page.evaluate(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  ) as Promise<ColourScheme>;

const windowWears = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBackgroundColor());

describe('the real app, in the colours of the system', () => {
  const run = useRun();

  // The window's own buttons are main's, painted in the variant main reads; the page is painted
  // in the one Chromium gives it. Dark buttons stood on a light page when the two disagreed (#155).
  it.each(Object.values(ColourScheme))(
    'wears the %s variant in the page and in the window, its buttons included',
    async (scheme) => {
      const scia = await run.launch(await run.profile());
      const other = scheme === ColourScheme.Dark ? ColourScheme.Light : ColourScheme.Dark;
      await systemAsks(scia.app, other);
      await until(async () => (await pageWears(scia.page)) === other);

      await systemAsks(scia.app, scheme);

      await until(async () => (await pageWears(scia.page)) === scheme);
      const colours = WINDOW_COLOURS[DEFAULT_THEME][scheme];
      await until(async () => (await windowWears(scia.app))?.toLowerCase() === colours.background);
    },
  );

  it('follows the theme chosen in Settings in the variant of the system', async () => {
    const scia = await run.launch(await run.profile());
    await systemAsks(scia.app, ColourScheme.Light);
    await scia.page.getByRole('button', { name: 'Settings' }).click();

    await scia.page.getByRole('combobox', { name: 'Theme' }).selectOption(Theme.Ice);

    const colours = WINDOW_COLOURS[Theme.Ice][ColourScheme.Light];
    await until(async () => (await windowWears(scia.app))?.toLowerCase() === colours.background);
    expect(await pageWears(scia.page)).toBe(ColourScheme.Light);
  });

  // 8 px and no arrow buttons, in every area that scrolls (#154): Chromium draws the system's,
  // arrows included, wherever the page's own are not taken.
  it('draws its own thin scrollbar where an area scrolls', async () => {
    const scia = await run.launch(await run.profile());

    const width = await scia.page.evaluate(() => {
      const area = document.createElement('div');
      area.style.cssText =
        'position:absolute;top:0;left:0;width:100px;height:100px;overflow:scroll';
      document.body.append(area);
      const gutter = area.offsetWidth - area.clientWidth;
      area.remove();
      return gutter;
    });

    expect(width).toBe(8);
  });
});
