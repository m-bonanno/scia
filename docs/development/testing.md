# Testing

| Layer       | Command                    | What it proves                                                                                                 |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unit        | `npm run test:unit`        | Rules: the domain, desktop engines, extension logic, React components                                          |
| Integration | `npm run test:integration` | The downloader against a real HTTP host and a real folder; main's ear on the engine against a real HTTP host   |
| Feature     | `npm run test:feature`     | The engine's API: tokens, scopes, status codes                                                                 |
| All         | `npm test`                 | The three above                                                                                                |
| E2E         | `npm run test:e2e`         | The built app, started by Electron: what a person does, against hosts on this computer (`npm run build` first) |

## Where CI runs them

The pipeline is [ADR 0008](../adr/0008-the-delivery-pipeline.md). The gates are one workflow, `.github/workflows/gates.yml`: run on every PR; called by `release.yml`, on the commit a merge into `develop` or `main` makes, before it is tagged — the smoke test left out, as the release smokes its own installer; and called by `burn-in.yml`, several times on one commit ("Burn-in", below):

| Job                                 | Runner           | Runs                                                   |
| ----------------------------------- | ---------------- | ------------------------------------------------------ |
| `Format, lint, types, tests, build` | `ubuntu-latest`  | format, lint, types, the three layers above, the build |
| `Windows tests, build`              | `windows-latest` | the three layers above, the build                      |
| `E2E (Windows)`                     | `windows-latest` | the build, then the E2E suite                          |
| `Installer smoke (Windows)`         | `windows-latest` | the installer of the commit, then the smoke test       |

A spec that holds on one system and not on the other is a bug of the spec or of the app on that system: Windows rounds a timer under 16 ms up to 16, and forgives a path written with the wrong separator, which Linux does not.

**No retries.** A spec that fails in CI without a cause in the change is not run again until it passes: it is filed as an issue with its log, then fixed, or skipped with that issue's number beside it until it is.

### Burn-in

A new job of the gates becomes a required check of `develop` and `main` only once it has run ten times in a row green on CI (the owner's decision 4, [ADR 0008](../adr/0008-the-delivery-pipeline.md)). The **Burn-in** workflow (`.github/workflows/burn-in.yml`) runs them: **Actions → Burn-in → Run workflow**, or `gh workflow run burn-in.yml --ref develop -f runs=10`, on `develop`'s head.

- It runs the whole of `gates.yml` — every job, the installer's smoke test included — `runs` times side by side, at most four at a time — sixteen jobs of the twenty a free account runs at once, so that a PR still finds room — each run in its own concurrency group; one that fails stops none of the others.
- **Ten green runs of one commit are a burn-in.** A run that fails is a failed burn-in: its log goes into an issue, the job is mended, and the burn-in starts again from zero on the mended commit — never a run again until ten pass.
- A burn-in uses free runners shared with every PR: it is started when nothing waits on them, and not again for a job already burned in, unless that job changed how it runs.

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

`apps/desktop/e2e/`, run by Vitest as the project `e2e` with `playwright-core`'s Electron driver ([ADR 0008](../adr/0008-the-delivery-pipeline.md)). It starts the app `npm run build` made, as `npm start` does — not the packaged exe, whose installer is the smoke test's (below).

- **One app at a time** (`fileParallelism: false`), each started by `launchScia` (`e2e/scia.ts`) with a profile of its own (`scratchProfile`: its log, its engine's state, its downloads) and `--port=0`, the engine taking a free port: a spec never meets another, another session's run, or the installed Scia. `launchScia` sets the port and the profile itself, and refuses a spec's own.
- **What a spec starts ends after it, whatever happened** (`useRun`): its apps — closed, and killed when they do not end, also when their start failed — its hosts and services, its profiles; and the log of main is printed for a spec that failed, as a CI runner keeps nothing else.
- **Hosts and services are local**, the ones the other layers use: `startRangeServer` and `startAllDebridServer`, imported from `@scia/server/testing/*`, and `until` from `@scia/server/testing/scratch.ts`. **No spec reaches a host that is not on this computer**: with no service connected, Scia still asks AllDebrid which hosts are its own (ADR 0006), so `launchScia` points every app at a simulated AllDebrid that knows no account, unless the spec names its own; and an app whose yt-dlp was fetched asks for yt-dlp's latest release (ADR 0011), so `launchScia` points it at a host of releases (`startReleasesServer`, `--yt-dlp-releases=`) whose latest is the release Scia ships, unless the spec names its own. Every key is made up.
- **The yt-dlp Scia ships is there**: CI's E2E job fetches it after the build (`node apps/desktop/scripts/fetch-tools.ts`, as `npm start` does), and the spec of its update fails, naming that command, when it is missing.
- **A person's road**: links are pasted in the bar and its button pressed (`paste`), Settings is opened and its controls used, the window is closed with `BrowserWindow.close()` from main — Electron's documented equivalent of its X: a close the window prevents and hands to main, the same road as the system's close message of "Proving the real app", item 5. The one thing answered for the person is the system's folder dialog, which a script cannot press (`dialog.showOpenDialog` replaced in main).
- **The window takes the spec's pointer, not the system's**: `launchScia` sets `setIgnoreMouseEvents(true)` on it, so the real cursor crossing it — a hand, another session's window — sends the page no pointer event, while playwright-core's own still reach it. A hover held for seconds (a notice under the pointer) failed 3 runs in 12 without it.
- **The variant, light or dark, is the system's, in the page as in main**: playwright-core tells the page that the system asks for light unless it is launched with `colorScheme: null`, which `launchScia` passes — without it main painted the window's buttons dark over a light page on a dark Windows (#155). A spec that needs a variant sets it as the system would, in main (`nativeTheme.themeSource`), and the page and main follow it together (`e2e/window.e2e.test.ts`).
- **An answer the engine cannot be made to give is given in its place, on the page's road only** (`page.route`): the notices' spec answers four adds with four refusals, the fourth once the focus is placed. It is the one stand-in for the engine; what the engine itself does is proven against the engine.
- **What a row does not say is read from the engine**, as the page reads it (`downloadsOf`): the bytes that arrived, the status of every download. `allCompleted` is false for an empty list.
- **Every wait is for a state** (`until`, on `performance.now()`), with bounds set for a cold start on a CI runner. A bound on a time is set against what the app does without the thing held, and counted from where the thing begins — the speed limit's spec is owed eight seconds from the host's first range, waits for more than six, and the file arrives in milliseconds without the limit, also when AllDebrid's public list never answers; at twice the limit it would take four.
- Each spec was seen failing with the line it holds taken away; a new one is too (`.claude/gotchas.md`, "Specs").

Run locally, its windows open on the screen, and a first close into the tray shows the system's notification, every profile being new. What it does not reach, and stays with a person or with a harness: the system's notifications and the tray as they are drawn, a hand on the mouse or the keys, the packaged app (the installer's smoke test, below), Linux.

## The installer's smoke test

`apps/desktop/e2e/installer.smoke.test.ts`, the Vitest project `smoke` (`npm run test:smoke`). One road, in order: it installs the NSIS installer named by `SCIA_INSTALLER` silently (`/S`); checks `Scia.exe` and its uninstaller are in `%LOCALAPPDATA%\Programs\scia`, and that the yt-dlp the packing fetched, in its `resources\tools`, answers `--version` with the version `apps/desktop/src/engine/runtime-layout.ts` fixes; starts the installed exe with the E2E harness (`launchScia(profile, { executable })`) on a scratch profile and a free port, against a simulated AllDebrid and a local host of yt-dlp's releases; reads in its log that it is the packaged app of `SCIA_VERSION`, that its engine is ready and that nothing is an error, main's or the engine's; downloads a pasted link from a local host, byte for byte; quits by closing its window; and uninstalls silently until its folder is gone.

- **It runs on a Windows CI runner only.** An install replaces the Scia installed on the machine: the spec refuses to start without `CI=true`, Windows, `SCIA_INSTALLER` and `SCIA_VERSION`. On a person's computer the packaged app is tried unpacked, which installs nothing: `npx electron-builder --config electron-builder.yml --dir --publish never` in `apps/desktop`, then `launchScia(profile, { executable: 'release/win-unpacked/Scia.exe' })`.
- **Where it runs** ([ADR 0008](../adr/0008-the-delivery-pipeline.md)): on every PR and in a burn-in, on an installer packaged from the commit at version `0.0.0` (`gates.yml`, `Installer smoke (Windows)`); in every release, on the installer with the release's version, **before its files are attached** (`release.yml`): a failure attaches nothing.
- **A release's smoke test reaches GitHub.** At a release's version the updater is on (ADR 0007) and reads this repository's releases; at `0.0.0`, on a PR, it is off and nothing leaves the runner. The spec refuses a run in which an update was installed at the quit: what was tried is what is uninstalled.
- **What it does not reach**: an install over an earlier Scia, and the update from one release to the next; SmartScreen on a downloaded installer; a person's hand. Those stay with a person ([`release-flow.md`](./release-flow.md), "Releasing").

## Proving the real app

What the E2E suite can hold is held there. What it cannot — something the system draws, a timing it cannot set up, a run longer than a CI job — is proven by hand, and the PR body says what ran:

1. `npm start` — builds everything and launches Electron with `--user-data-dir=.dev-profile --port=47822`.
2. Do the thing; then read `apps/desktop/.dev-profile/logs/main.log`. A healthy-looking window has hidden a dead subsystem before: **read the log**.
3. For a download, point it at a local host rather than someone's server. For a service, start the simulated one on a port and launch with `--alldebrid-api=http://127.0.0.1:<port>`: the engine takes an address on this computer and no other. A run whose yt-dlp was fetched (`npm start` fetches it) asks GitHub for yt-dlp's latest release once a day (ADR 0011) unless it is launched with `--yt-dlp-releases=http://127.0.0.1:<port>`, a host that answers as `apps/server/src/testing/yt-dlp-releases-server.ts` does. The key typed in such a run is one the simulated service was given, never a real one.
4. To drive the window from a script, add `--remote-debugging-port=<n>` and speak the DevTools protocol to it. Such harnesses are not committed.
5. To close the window as its X does, send it the system's close message (`(Get-Process -Id <pid>).CloseMainWindow()` on Windows): the page's own `window.close()` and the protocol's `Browser.close` are different roads, and neither is the person's.
