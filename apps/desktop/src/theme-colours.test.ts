import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ColourScheme, DEFAULT_THEME, THEMES, WINDOW_COLOURS } from '@scia/contracts/theme';
import { describe, expect, it } from 'vitest';
import { titleBarOverlay } from './engine/title-bar.ts';

type Tokens = Record<string, string | undefined>;

const styles = readFileSync(
  join(import.meta.dirname, '..', '..', 'renderer', 'src', 'themes.css'),
  'utf8',
);
const pageRules = readFileSync(
  join(import.meta.dirname, '..', '..', 'renderer', 'src', 'styles.css'),
  'utf8',
);

// A block without a name is the default theme's: the page wears it before anything names one.
function themesOf(css: string): Map<string, Tokens> {
  const themes = new Map<string, Tokens>();
  for (const [, name, body] of css.matchAll(/:root(?:\[data-theme='([\w-]+)'\])?\s*\{([^}]*)\}/g)) {
    const tokens: Tokens = {};
    for (const [, token, value] of (body ?? '').matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      if (token !== undefined) tokens[token] = value?.trim();
    }
    themes.set(name ?? DEFAULT_THEME, tokens);
  }
  return themes;
}

const LIGHT = '@media (prefers-color-scheme: light)';

function variantsOf(css: string): Record<ColourScheme, Map<string, Tokens>> {
  const lightStart = css.indexOf(LIGHT);
  return {
    [ColourScheme.Dark]: themesOf(css.slice(0, lightStart)),
    [ColourScheme.Light]: themesOf(css.slice(lightStart)),
  };
}

const page = variantsOf(styles);

const variants = THEMES.flatMap((theme) =>
  Object.values(ColourScheme).map((scheme) => ({ theme, scheme })),
);

function tokensOf(theme: string, scheme: ColourScheme): Tokens {
  return page[scheme].get(theme) ?? {};
}

// WCAG 2.2: the relative luminance of an sRGB colour, and the contrast of two.
function luminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(one: string, other: string): number {
  const [lighter = 0, darker = 0] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// 1.4.3: text against what it is written on.
const TEXT = 4.5;
// 1.4.11: what is not text and has to be seen — a bar on its track, an icon, the focus outline.
const NOT_TEXT = 3;

// Every pair the page puts one on the other (apps/renderer/src: the classes that name them).
const PAIRS: readonly (readonly [string, string, number])[] = [
  ['foreground', 'background', TEXT],
  ['foreground', 'surface', TEXT],
  ['foreground', 'surface-hover', TEXT],
  ['foreground', 'tonal', TEXT],
  // A text button under the pointer (TEXT_BUTTON in apps/renderer/src/components/button-styles.ts).
  ['foreground', 'border', TEXT],
  ['muted-foreground', 'background', TEXT],
  // Also a field's placeholder, which alone draws the key's field on the dialog at rest (#66).
  ['muted-foreground', 'surface', TEXT],
  ['muted-foreground', 'surface-hover', TEXT],
  ['muted-foreground', 'tonal', TEXT],
  ['destructive', 'background', TEXT],
  ['destructive', 'surface', TEXT],
  ['destructive', 'surface-hover', TEXT],
  ['accent-foreground', 'accent', TEXT],
  ['destructive-foreground', 'destructive', TEXT],
  ['accent', 'background', NOT_TEXT],
  ['accent', 'surface', NOT_TEXT],
  ['accent', 'surface-hover', NOT_TEXT],
  ['accent', 'tonal', NOT_TEXT],
  ['destructive', 'tonal', NOT_TEXT],
  ['ring', 'background', NOT_TEXT],
  ['ring', 'surface', NOT_TEXT],
  // A focused button of a row under the pointer; the × inside a notice.
  ['ring', 'surface-hover', NOT_TEXT],
  ['ring', 'tonal', NOT_TEXT],
  // The scrollbar's thumb, at rest and under the pointer, on the grounds of the areas that
  // scroll: the list on the page, Settings on its surface (#154).
  ['muted-foreground', 'background', NOT_TEXT],
  ['muted-foreground', 'surface', NOT_TEXT],
  ['foreground', 'background', NOT_TEXT],
  ['foreground', 'surface', NOT_TEXT],
];

describe('the themes of the page', () => {
  it('are the ones a person can choose, each in a dark and a light variant', () => {
    expect([...page.dark.keys()].sort()).toEqual([...THEMES].sort());
    expect([...page.light.keys()].sort()).toEqual([...THEMES].sort());
  });

  it.each(variants)('$theme defines every token in its $scheme variant', ({ theme, scheme }) => {
    const reference = Object.keys(tokensOf(DEFAULT_THEME, ColourScheme.Dark)).sort();

    expect(reference).toContain('background');
    expect(Object.keys(tokensOf(theme, scheme)).sort()).toEqual(reference);
  });

  it.each(variants)(
    '$theme keeps its text and its marks readable in its $scheme variant',
    ({ theme, scheme }) => {
      const tokens = tokensOf(theme, scheme);
      const short = PAIRS.flatMap(([on, under, least]) => {
        const ratio = contrast(tokens[on] ?? '', tokens[under] ?? '');
        return ratio >= least
          ? []
          : [`${on} on ${under}: ${ratio.toFixed(2)}, under ${String(least)}`];
      });

      expect(short).toEqual([]);
    },
  );
});

// A state of the page is a pair too: selected text is written on the selection's own ground,
// whatever was under it.
describe('selected text', () => {
  const rule = /::selection\s*\{([^}]*)\}/.exec(pageRules)?.[1] ?? '';

  it('is two tokens that every theme holds to the contrast of text', () => {
    const ground = /background:\s*var\(--([\w-]+)\);/.exec(rule)?.[1];
    const text = /(?:^|\s)color:\s*var\(--([\w-]+)\);/.exec(rule)?.[1];

    expect(PAIRS).toContainEqual([text, ground, TEXT]);
  });
});

// The scrollbar is the page's own, in its tokens: the system's has arrow buttons and no theme.
describe('the scrollbar', () => {
  const groundOf = (selector: string) => {
    const at = pageRules.indexOf(`${selector} {`);
    const rule = at < 0 ? '' : pageRules.slice(at, pageRules.indexOf('}', at));
    return /background:\s*var\(--([\w-]+)\)/.exec(rule)?.[1];
  };

  it.each([
    ['at rest', '::-webkit-scrollbar-thumb'],
    ['under the pointer', '::-webkit-scrollbar-thumb:hover'],
  ])('wears a thumb %s that every theme holds to 3:1 on every ground that scrolls', (_, rule) => {
    const thumb = groundOf(rule);

    expect(PAIRS).toContainEqual([thumb, 'background', NOT_TEXT]);
    expect(PAIRS).toContainEqual([thumb, 'surface', NOT_TEXT]);
  });

  // Chromium lets the standard properties win over its own pseudo-elements, and with them it
  // draws its arrow buttons again.
  it('is not handed back to the system by the standard properties', () => {
    expect(pageRules).not.toMatch(/scrollbar-(width|color)\s*:/);
  });
});

describe('the extension’s pages', () => {
  const extension = variantsOf(
    readFileSync(join(import.meta.dirname, '..', '..', 'extension', 'static', 'ui.css'), 'utf8'),
  );

  it.each(Object.values(ColourScheme))(
    'wear the default theme of the app in its %s variant',
    (scheme) => {
      const own = extension[scheme].get(DEFAULT_THEME) ?? {};

      expect(Object.keys(own)).toContain('background');
      expect(tokensOf(DEFAULT_THEME, scheme)).toMatchObject(own);
    },
  );
});

// The window's own buttons, focused and not, are an icon on the title bar's ground (#155).
describe('the window’s own buttons', () => {
  it.each(variants)('are seen on their ground in $theme, $scheme', ({ theme, scheme }) => {
    for (const focused of [true, false]) {
      const { color, symbolColor } = titleBarOverlay(theme, scheme, focused);

      expect(contrast(symbolColor, color)).toBeGreaterThanOrEqual(NOT_TEXT);
    }
  });
});

// Main paints the window before the page loads, so the two must agree on the colours.
describe('the window colours main paints with', () => {
  it.each(variants)('are the page’s own in $theme, $scheme', ({ theme, scheme }) => {
    const tokens = tokensOf(theme, scheme);

    expect(WINDOW_COLOURS[theme][scheme]).toEqual({
      background: tokens.background,
      foreground: tokens.foreground,
      inactiveForeground: tokens['muted-foreground'],
    });
  });
});
