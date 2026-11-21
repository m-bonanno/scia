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

interface Overlay {
  readonly color: string;
  readonly symbolColor: string;
}

// Electron gives no way to read the colours of the window's own buttons back: what main last
// asked of the system is recorded on its way there, and still handed on.
async function recordOverlay(app: ElectronApplication): Promise<() => Promise<Overlay | null>> {
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('No window to record.');
    const paint = window.setTitleBarOverlay.bind(window);
    window.setTitleBarOverlay = (overlay) => {
      Object.assign(globalThis, { sciaOverlay: overlay });
      paint(overlay);
    };
  });
  return () =>
    app.evaluate<Overlay | null>(
      () => (globalThis as { sciaOverlay?: Overlay }).sciaOverlay ?? null,
    );
}

// The window's background, and its buttons — focused or not, their symbol is one of the two.
async function windowIn(
  app: ElectronApplication,
  overlay: () => Promise<Overlay | null>,
  theme: Theme,
  scheme: ColourScheme,
): Promise<boolean> {
  const colours = WINDOW_COLOURS[theme][scheme];
  const background = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
  );
  const buttons = await overlay();
  return (
    background?.toLowerCase() === colours.background &&
    buttons?.color === colours.background &&
    [colours.foreground, colours.inactiveForeground].includes(buttons.symbolColor)
  );
}

// Reads the pixels of a stretch of the page as drawn: the page decodes its own capture.
async function pixelsOf(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<number[][]> {
  const shot = await page.screenshot({ clip, scale: 'css' });
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas.');
    context.drawImage(image, 0, 0);
    const data = [...context.getImageData(0, 0, image.width, image.height).data];
    return Array.from({ length: image.width * image.height }, (_, n) =>
      data.slice(n * 4, n * 4 + 3),
    );
  }, shot.toString('base64'));
}

const near = (one: number[], other: number[]) =>
  one.every((channel, n) => Math.abs(channel - (other[n] ?? -1)) <= 2);

describe('the real app, in the colours of the system', () => {
  const run = useRun();

  // The window's own buttons are main's, painted in the variant main reads; the page is painted
  // in the one Chromium gives it. Dark buttons stood on a light page when the two disagreed (#155).
  it.each(Object.values(ColourScheme))(
    'wears the %s variant in the page and in the window, its buttons included',
    async (scheme) => {
      const scia = await run.launch(await run.profile());
      const overlay = await recordOverlay(scia.app);
      const other = scheme === ColourScheme.Dark ? ColourScheme.Light : ColourScheme.Dark;
      await systemAsks(scia.app, other);
      await until(async () => (await pageWears(scia.page)) === other);

      await systemAsks(scia.app, scheme);

      await until(async () => (await pageWears(scia.page)) === scheme);
      await until(() => windowIn(scia.app, overlay, DEFAULT_THEME, scheme));
    },
  );

  it('follows the theme chosen in Settings in the variant of the system', async () => {
    const scia = await run.launch(await run.profile());
    const overlay = await recordOverlay(scia.app);
    await systemAsks(scia.app, ColourScheme.Light);
    await scia.page.getByRole('button', { name: 'Settings' }).click();

    await scia.page.getByRole('combobox', { name: 'Theme' }).selectOption(Theme.Ice);

    await until(() => windowIn(scia.app, overlay, Theme.Ice, ColourScheme.Light));
    await until(async () => (await pageWears(scia.page)) === ColourScheme.Light);
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

  // Chromium does not clip a scrollbar to its area's rounded corners: without arrows at its ends,
  // the thumb of Settings, at the top or at the bottom of its scroll, was drawn over the veil
  // beyond the dialog's corner.
  it.each(['top', 'bottom'] as const)(
    'keeps the thumb of Settings inside its corner, scrolled to the %s',
    async (end) => {
      const scia = await run.launch(await run.profile());
      const { page } = scia;
      // The window at its smallest: Settings scrolls.
      await scia.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(640, 420);
      });
      await until(() => page.evaluate(() => window.innerHeight === 420));
      await page.getByRole('button', { name: 'Settings' }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      // Its rows and its services drawn: before them it is short, and nothing scrolls.
      await page.getByText('Simultaneous downloads').waitFor();
      await page.getByRole('region', { name: 'Integrations' }).getByText('AllDebrid').waitFor();
      await until(() => dialog.evaluate((element) => element.scrollHeight > element.clientHeight));
      await dialog.evaluate((element, to) => {
        element.scrollTop = to === 'top' ? 0 : element.scrollHeight;
      }, end);
      await until(() =>
        dialog.evaluate(
          (element, to) =>
            to === 'top'
              ? element.scrollTop === 0
              : element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
          end,
        ),
      );
      await until(() => page.evaluate(() => document.getAnimations().length === 0));
      const box = await dialog.boundingBox();
      if (box === null) throw new Error('Settings is not drawn.');

      // Inside the corner's square, outside its rounding (a 16 px radius): two pixels in from the
      // right edge, four from the top or five from the bottom; and four beyond the edge, on the veil.
      const y = Math.round(end === 'top' ? box.y + 4 : box.y + box.height - 5);
      const right = Math.round(box.x + box.width);
      const [corner = [], veil = []] = [
        (await pixelsOf(page, { x: right - 2, y, width: 1, height: 1 }))[0],
        (await pixelsOf(page, { x: right + 4, y, width: 1, height: 1 }))[0],
      ];

      expect(near(corner, veil), `corner ${String(corner)}, veil ${String(veil)}`).toBe(true);
    },
  );
});
