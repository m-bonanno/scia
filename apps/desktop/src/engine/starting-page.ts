import { ColourScheme, type Theme, WINDOW_COLOURS } from '@scia/contracts/theme';

export const STARTING_LINE = 'Scia is starting…';

// What the window shows from its first moment until the engine's page is loaded: a cold start can
// take a minute, and a window that waits for the page shows nothing for as long (#13). The
// theme's colours in the variant the system asks for; no script — the preload hands every page
// of the window the engine's token — and nothing loaded from anywhere. The page has no frame to
// be held by, so any point of it moves the window.
export function startingPage(theme: Theme): string {
  const light = WINDOW_COLOURS[theme][ColourScheme.Light];
  const dark = WINDOW_COLOURS[theme][ColourScheme.Dark];
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Scia</title>
<style>
html { height: 100%; -webkit-app-region: drag; user-select: none; cursor: default; }
body { margin: 0; height: 100%; display: flex; align-items: center; justify-content: center; font: 14px system-ui, sans-serif; background: ${light.background}; color: ${light.inactiveForeground}; }
@media (prefers-color-scheme: dark) { body { background: ${dark.background}; color: ${dark.inactiveForeground}; } }
</style>
</head>
<body><p role="status">${STARTING_LINE}</p></body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
