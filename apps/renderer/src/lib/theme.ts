import type { Theme } from '@scia/contracts/theme';
import { bridge } from './bridge.ts';

// The page wears the theme named on <html> (themes.css). The engine names it in the page it
// serves; this names it again when the person chooses another, and where no engine served the
// page (development).
export function wearTheme(theme: Theme): void {
  const page = document.documentElement;
  if (page.dataset.theme === theme) return;
  page.dataset.theme = theme;
  // The window's own colours follow. A shell that fails to follow changes nothing here: the page
  // wears the theme all the same, and main logs why the window does not.
  bridge()
    ?.themeChanged()
    .catch(() => undefined);
}
