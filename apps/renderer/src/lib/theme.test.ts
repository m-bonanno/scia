import { afterEach, describe, expect, it, vi } from 'vitest';
import { wearTheme } from './theme.ts';

function aShell() {
  const themeChanged = vi.fn(async () => undefined);
  window.scia = {
    apiToken: 'token',
    version: '1.0.0',
    platform: 'win32',
    revealDownload: vi.fn(async () => undefined),
    openDownload: vi.fn(async () => undefined),
    chooseDownloadFolder: vi.fn(async () => 'kept'),
    themeChanged,
    updateOffered: vi.fn(async () => null),
    onUpdateChanged: vi.fn(() => () => undefined),
    restartToUpdate: vi.fn(async () => 'nothing'),
    openCodePage: vi.fn(async () => undefined),
    openSupportPage: vi.fn(async () => undefined),
  };
  return themeChanged;
}

describe('wearTheme', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    delete window.scia;
  });

  it('names the theme on the page, where the stylesheet reads it', () => {
    wearTheme('ice');

    expect(document.documentElement.dataset.theme).toBe('ice');
  });

  it('tells the desktop shell when the theme changes, naming nothing', () => {
    const themeChanged = aShell();

    wearTheme('ice');

    expect(themeChanged).toHaveBeenCalledExactlyOnceWith();
  });

  it('says nothing for the theme the page already wears, as the engine served it', () => {
    document.documentElement.dataset.theme = 'ice';
    const themeChanged = aShell();

    wearTheme('ice');

    expect(themeChanged).not.toHaveBeenCalled();
  });

  it('names the theme on the page whatever the shell answers', async () => {
    aShell().mockRejectedValue(new Error('the engine is silent'));

    wearTheme('space');
    await Promise.resolve();

    expect(document.documentElement.dataset.theme).toBe('space');
  });
});
