# Scia — design

Captures of the real app: its page, read over the DevTools protocol while the app runs on a scratch profile and downloads from local test hosts. The page only — the window's own buttons, which the system draws at the right of the title bar, are not in them.

| Capture                                                                | Shows                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`downloads-in-progress.png`](./downloads-in-progress.png)             | The list with data, dark theme: a queued, three running and one finished file |
| [`downloads-in-progress-light.png`](./downloads-in-progress-light.png) | The same list, light theme                                                    |
| [`settings.png`](./settings.png)                                       | The Settings dialog, dark theme                                               |

The pairing code and the folder in `settings.png` belong to that scratch profile, deleted after the capture: the code opens nothing.

A capture is retaken in the PR that changes what it shows (`apps/renderer/CLAUDE.md`, "Behaviour"; the product designer checks it).

Not captured yet: the empty list, the engine unreachable, a failed download, the extension's popup and options.
