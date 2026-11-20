# Scia — design

Captures of the real app: its page, read over the DevTools protocol while the app runs on a scratch profile and downloads from local test hosts. The page only — the window's own buttons, which the system draws at the right of the title bar, are not in them.

| Capture                                                                | Shows                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`downloads-in-progress.png`](./downloads-in-progress.png)             | The list with data, dark theme: a queued, three running and one finished file                                                                            |
| [`downloads-in-progress-light.png`](./downloads-in-progress-light.png) | The same list, light theme                                                                                                                               |
| [`settings.png`](./settings.png)                                       | The Settings dialog, dark theme: the two counters, the speed limit, the folder and the button that changes it, and Integrations with AllDebrid connected |
| [`connect-a-service.png`](./connect-a-service.png)                     | Settings while AllDebrid is being connected: the field that hides the key, and a key the service refused, said by the field                              |
| [`speed-limit.png`](./speed-limit.png)                                 | A download held under a speed limit: the limit said beside the total speed                                                                               |
| [`run-a-program.png`](./run-a-program.png)                             | A finished program whose "Open" was pressed once: the button asks, as "Run"                                                                              |
| [`run-a-program-light.png`](./run-a-program-light.png)                 | The same, light theme                                                                                                                                    |

The pairing code and the folder in `settings.png` belong to that scratch profile, deleted after the capture: the code opens nothing. The AllDebrid account in it is the simulated service's (`apps/server/src/testing/alldebrid-server.ts`): no such account exists, and the key typed for these captures was made up.

A capture is retaken in the PR that changes what it shows (`apps/renderer/CLAUDE.md`, "Behaviour"; the product designer checks it).

Not captured yet: Settings in the light theme and with a folder refused, a connected service that says its key is no longer accepted, the open list of the speed limit's menu (the system draws it outside the page: no capture of the page shows it, and nobody has looked at it in either theme), the title bar with a limit in the light theme, the empty list, the engine unreachable, a failed download, the extension's popup and options.
