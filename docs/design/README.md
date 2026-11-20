# Scia — design

Captures of the real app: its page, read over the DevTools protocol while the app runs on a scratch profile and downloads from local test hosts. The page only — the window's own buttons, which the system draws at the right of the title bar, are not in them.

The app wears one of nine themes, each in a light and a dark variant that follows the system: [`themes.md`](./themes.md) says where every colour of each comes from. The captures below are in the default one, Black Tie.

| Capture                                                                | Shows                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`downloads-in-progress.png`](./downloads-in-progress.png)             | The list with data, dark variant: a queued, three running, one failed and one finished file                                    |
| [`downloads-in-progress-light.png`](./downloads-in-progress-light.png) | The same list, light variant                                                                                                   |
| [`settings.png`](./settings.png)                                       | The Settings dialog, dark variant: the two counters, the speed limit, the folder and the button that changes it, and the theme |
| [`settings-light.png`](./settings-light.png)                           | The same, light variant                                                                                                        |
| [`speed-limit.png`](./speed-limit.png)                                 | A download held under a speed limit: the limit said beside the total speed                                                     |
| [`run-a-program.png`](./run-a-program.png)                             | A finished program whose "Open" was pressed once: the button asks, as "Run"                                                    |
| [`run-a-program-light.png`](./run-a-program-light.png)                 | The same, light variant                                                                                                        |
| [`downloads-paused.png`](./downloads-paused.png)                       | A paused download beside the running ones, dark variant: in the default theme the two bars differ by tone alone                |
| [`downloads-paused-light.png`](./downloads-paused-light.png)           | The same, light variant                                                                                                        |
| [`themes/<theme>-dark.png`](./themes/)                                 | The list of `downloads-in-progress.png` in each of the other eight themes, dark variant                                        |
| [`themes/<theme>-light.png`](./themes/)                                | The same, light variant                                                                                                        |

The pairing code and the folder in the two captures of Settings belong to that scratch profile, deleted after the capture: the code opens nothing.

The light variant of a capture is the page told that the system asks for light (the protocol's emulated `prefers-color-scheme`), on a system that was dark: the page's colours are the light variant's, and the window's own buttons, which are not in a capture, were not seen in it.

A capture is retaken in the PR that changes what it shows (`apps/renderer/CLAUDE.md`, "Behaviour"; the product designer checks it).

Not captured yet: Settings with a folder refused, the open list of a menu of Settings — the speed limit's, the theme's — (the system draws it outside the page, so no capture of the page shows it; it was read from the system in the review of #52, in every theme and both variants: its rows are the theme's `tonal` and `foreground`, its chosen row Chromium's own blue — #58), the title bar with a limit in the light variant, Settings and "Run" in a theme that is not the default one, the empty list, the engine unreachable, the extension's popup and options.
