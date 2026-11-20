# Scia — design

Captures of the real app: its page, read over the DevTools protocol while the app runs on a scratch profile and downloads from local test hosts. The page only — the window's own buttons, which the system draws at the right of the title bar, are not in them.

| Capture                                                                | Shows                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`downloads-in-progress.png`](./downloads-in-progress.png)             | The list with data, dark theme: a queued, three running and one finished file                                 |
| [`downloads-in-progress-light.png`](./downloads-in-progress-light.png) | The same list, light theme                                                                                    |
| [`settings.png`](./settings.png)                                       | The Settings dialog, dark theme: the two counters, the speed limit, the folder and the button that changes it |
| [`speed-limit.png`](./speed-limit.png)                                 | A download held under a speed limit: the limit said beside the total speed                                    |
| [`run-a-program.png`](./run-a-program.png)                             | A finished program whose "Open" was pressed once: the button asks, as "Run"                                   |
| [`run-a-program-light.png`](./run-a-program-light.png)                 | The same, light theme                                                                                         |

The pairing code and the folder in `settings.png` belong to that scratch profile, deleted after the capture: the code opens nothing.

A capture is retaken in the PR that changes what it shows (`apps/renderer/CLAUDE.md`, "Behaviour"; the product designer checks it).

Not captured yet: Settings in the light theme and with a folder refused, the empty list, the engine unreachable, a failed download, the extension's popup and options.
