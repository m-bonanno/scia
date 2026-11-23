import { ColourScheme, THEMES, WINDOW_COLOURS } from '@scia/contracts/theme';
import { describe, expect, it } from 'vitest';
import { STARTING_LINE, startingPage } from './starting-page.ts';

const PREFIX = 'data:text/html;charset=utf-8,';

const htmlOf = (address: string) => {
  expect(address.startsWith(PREFIX)).toBe(true);
  return decodeURIComponent(address.slice(PREFIX.length));
};

// The rules the page gives its body: in the light variant, and in the dark one.
const bodyRules = (html: string) => {
  const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*body\s*\{([^}]*)\}/.exec(html)?.[1];
  const light = /(?:^|\n)\s*body\s*\{([^}]*)\}/.exec(html)?.[1];
  return { light: light ?? '', dark: dark ?? '' };
};

describe('startingPage', () => {
  it('says that Scia is starting', () => {
    const html = htmlOf(startingPage(THEMES[0]!));

    expect(STARTING_LINE).toBe('Scia is starting…');
    expect(html).toContain(`<p role="status">${STARTING_LINE}</p>`);
    expect(html).toContain('<title>Scia</title>');
  });

  it.each(THEMES)('wears the colours of %s in both variants, the system choosing', (theme) => {
    const rules = bodyRules(htmlOf(startingPage(theme)));

    for (const scheme of Object.values(ColourScheme)) {
      const colours = WINDOW_COLOURS[theme][scheme];
      expect(rules[scheme]).toContain(`background: ${colours.background};`);
      expect(rules[scheme]).toContain(`color: ${colours.inactiveForeground};`);
    }
  });

  // The window has no frame of its own to be held by while it starts (engine/title-bar.ts).
  it('lets the window be moved by any point of it', () => {
    expect(htmlOf(startingPage(THEMES[0]!))).toMatch(/html\s*\{[^}]*-webkit-app-region: drag;/);
  });

  // The window's preload hands every page the engine's token: this one may run nothing.
  it('runs no script and loads nothing', () => {
    const html = htmlOf(startingPage(THEMES[0]!));

    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    );
    expect(html).not.toMatch(/<script|\son\w+=|src=|href=/i);
  });
});
