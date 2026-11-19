import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WINDOW_COLOURS } from '@scia/contracts/theme';
import { describe, expect, it } from 'vitest';

// Main paints the window before the page loads, so the two must agree on the colours.
const styles = readFileSync(
  join(import.meta.dirname, '..', '..', 'renderer', 'src', 'styles.css'),
  'utf8',
);

function tokensOf(block: string): Record<string, string | undefined> {
  const tokens: Record<string, string | undefined> = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    if (name !== undefined) tokens[name] = value?.trim();
  }
  return tokens;
}

const lightStart = styles.indexOf('@media (prefers-color-scheme: light)');
const dark = tokensOf(styles.slice(styles.indexOf(':root {'), lightStart));
const light = tokensOf(styles.slice(lightStart, styles.indexOf('@utility title-bar')));

describe('the window colours main paints with', () => {
  it.each([
    ['dark', dark],
    ['light', light],
  ] as const)('are the page’s own in the %s theme', (theme, tokens) => {
    expect(WINDOW_COLOURS[theme]).toEqual({
      background: tokens.background,
      foreground: tokens.foreground,
      inactiveForeground: tokens['muted-foreground'],
    });
  });

  it('defines the same tokens in both themes', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });
});
