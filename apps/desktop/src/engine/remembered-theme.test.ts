import { DEFAULT_THEME, Theme } from '@scia/contracts/theme';
import { describe, expect, it } from 'vitest';
import { RememberedTheme, type ThemeStore } from './remembered-theme.ts';

function storing(stored: unknown) {
  const writes: unknown[] = [];
  const store: ThemeStore = {
    read: async () => {
      if (stored instanceof Error) throw stored;
      return stored;
    },
    write: async (value) => {
      writes.push(value);
    },
  };
  return { theme: new RememberedTheme(store), writes };
}

describe('RememberedTheme', () => {
  it('reads the theme the engine said last time', async () => {
    const { theme } = storing({ theme: Theme.Brick });

    expect(await theme.read()).toBe(Theme.Brick);
  });

  it.each([
    ['nothing kept', undefined],
    ['a theme Scia does not know', { theme: 'neon' }],
    ['something else', ['brick']],
    ['a file that cannot be read', new Error('EACCES')],
  ])('reads the default theme for %s', async (_, stored) => {
    const { theme } = storing(stored);

    expect(await theme.read()).toBe(DEFAULT_THEME);
  });

  it('keeps a theme the engine says, once', async () => {
    const { theme, writes } = storing(undefined);
    await theme.read();

    await theme.keep(Theme.Ice);
    await theme.keep(Theme.Ice);

    expect(writes).toEqual([{ theme: Theme.Ice }]);
  });

  it('does not write again the theme it read', async () => {
    const { theme, writes } = storing({ theme: Theme.Earth });
    await theme.read();

    await theme.keep(Theme.Earth);

    expect(writes).toEqual([]);
  });

  it('never stops anything for a write that fails, and tries it again at the next', async () => {
    let fails = true;
    const writes: unknown[] = [];
    const theme = new RememberedTheme({
      read: async () => undefined,
      write: async (value) => {
        if (fails) throw new Error('read-only profile');
        writes.push(value);
      },
    });

    await expect(theme.keep(Theme.Space)).resolves.toBeUndefined();
    fails = false;
    await theme.keep(Theme.Space);

    expect(writes).toEqual([{ theme: Theme.Space }]);
  });
});
