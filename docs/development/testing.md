# Testing

| Layer       | Command                    | What it proves                                                                                                 |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unit        | `npm run test:unit`        | Rules: the domain, desktop engines, extension logic, React components                                          |
| Integration | `npm run test:integration` | The downloader against a real HTTP host and a real folder; main's ear on the engine against a real HTTP host   |
| Feature     | `npm run test:feature`     | The engine's API: tokens, scopes, status codes                                                                 |
| All         | `npm test`                 | The three above                                                                                                |
| E2E         | `npm run test:e2e`         | The built app, started by Electron: what a person does, against hosts on this computer (`npm run build` first) |

## Where CI runs them

The pipeline is [ADR 0008](../adr/0008-the-delivery-pipeline.md). The gates are one workflow, `.github/workflows/gates.yml`, run on every PR and, called by `release.yml`, on the commit a merge into `develop` or `main` makes, before it is tagged:

| Job                                 | Runner           | Runs                                                   |
| ----------------------------------- | ---------------- | ------------------------------------------------------ |
| `Format, lint, types, tests, build` | `ubuntu-latest`  | format, lint, types, the three layers above, the build |
| `Windows tests, build`              | `windows-latest` | the three layers above, the build                      |
| `E2E (Windows)`                     | `windows-latest` | the build, then the E2E suite                          |

A spec that holds on one system and not on the other is a bug of the spec or of the app on that system: Windows rounds a timer under 16 ms up to 16, and forgives a path written with the wrong separator, which Linux does not.

**No retries.** A spec that fails in CI without a cause in the change is not run again until it passes: it is filed as an issue with its log, then fixed, or skipped with that issue's number beside it until it is.

## Writing a spec

- The name of a spec is the rule it holds: `'never overwrites a file already in the folder'`.
- One behaviour per spec; arrange, act, assert, with a blank line between.
- Integration specs compare **bytes** (`Buffer.compare`), not counters that could agree by accident.
- No fixed sleeps. Wait for a state with `until(() => …)` (`apps/server/src/testing/scratch.ts`); inject delays (`retryDelayMs`). A wait that is the case itself is not a wait for an outcome — a reader that stays away from a host, the stretch over which a rate is measured — and says so where it stands.
- Each spec gets its own temp folder and its own host (`startRangeServer`), and removes them.
- A host that misbehaves is an option of `startRangeServer` (`drops`, `ranges: false`, `status`, `announcesLength: false`), not a mock of `http`.
- A service Scia connects to is a local host as well: `startAllDebridServer` (`apps/server/src/testing/alldebrid-server.ts`) answers as AllDebrid's documentation says, and refuses or misbehaves when told to. Every key in a spec is made up; no spec and no run uses a real one.
- Never hardcode a Windows path separator in a spec: build paths with `path.join`. CI runs every spec on Linux and on Windows.

## E2E

`apps/desktop/e2e/`, run by Vitest as the project `e2e` with `playwright-core`'s Electron driver ([ADR 0008](../adr/0008-the-delivery-pipeline.md)). It starts the app `npm run build` made, as `npm start` does — not the packaged exe, whose installer is the smoke test's (#92).

- **One app at a time** (`fileParallelism: false`), each started by `launchScia` (`e2e/scia.ts`) with a profile of its own (`scratchProfile`: its log, its engine's state, its downloads) and `--port=0`, the engine taking a free port: a spec never meets another, another session's run, or the installed Scia. `launchScia` sets the port and the profile itself, and refuses a spec's own.
- **What a spec starts ends after it, whatever happened** (`useRun`): its apps — closed, and killed when they do not end, also when their start failed — its hosts and services, its profiles; and the log of main is printed for a spec that failed, as a CI runner keeps nothing else.
- **Hosts and services are local**, the ones the other layers use: `startRangeServer` and `startAllDebridServer`, imported from `@scia/server/testing/*`, and `until` from `@scia/server/testing/scratch.ts`. **No spec reaches a host that is not on this computer**: with no service connected, Scia still asks AllDebrid which hosts are its own (ADR 0006), so `launchScia` points every app at a simulated AllDebrid that knows no account, unless the spec names its own. Every key is made up.
- **A person's road**: links are pasted in the bar and its button pressed (`paste`), Settings is opened and its controls used, the window is closed with `BrowserWindow.close()` from main — Electron's documented equivalent of its X: a close the window prevents and hands to main, the same road as the system's close message of "Proving the real app", item 5. The one thing answered for the person is the system's folder dialog, which a script cannot press (`dialog.showOpenDialog` replaced in main).
- **What a row does not say is read from the engine**, as the page reads it (`downloadsOf`): the bytes that arrived, the status of every download. `allCompleted` is false for an empty list.
- **Every wait is for a state** (`until`, on `performance.now()`), with bounds set for a cold start on a CI runner. A bound on a time is set against what the app does without the thing held, and counted from where the thing begins — the speed limit's spec is owed eight seconds from the host's first range, waits for more than six, and the file arrives in milliseconds without the limit, also when AllDebrid's public list never answers; at twice the limit it would take four.
- Each spec was seen failing with the line it holds taken away; a new one is too (`.claude/gotchas.md`, "Specs").

Run locally, its windows open on the screen, and a first close into the tray shows the system's notification, every profile being new. What it does not reach, and stays with a person or with a harness: the system's notifications and the tray as they are drawn, a hand on the mouse or the keys, the packaged app (the smoke test, #92), Linux.

## Proving the real app

What the E2E suite can hold is held there. What it cannot — something the system draws, a timing it cannot set up, a run longer than a CI job — is proven by hand, and the PR body says what ran:

1. `npm start` — builds everything and launches Electron with `--user-data-dir=.dev-profile --port=47822`.
2. Do the thing; then read `apps/desktop/.dev-profile/logs/main.log`. A healthy-looking window has hidden a dead subsystem before: **read the log**.
3. For a download, point it at a local host rather than someone's server. For a service, start the simulated one on a port and launch with `--alldebrid-api=http://127.0.0.1:<port>`: the engine takes an address on this computer and no other. The key typed in such a run is one the simulated service was given, never a real one.
4. To drive the window from a script, add `--remote-debugging-port=<n>` and speak the DevTools protocol to it. Such harnesses are not committed.
5. To close the window as its X does, send it the system's close message (`(Get-Process -Id <pid>).CloseMainWindow()` on Windows): the page's own `window.close()` and the protocol's `Browser.close` are different roads, and neither is the person's.
