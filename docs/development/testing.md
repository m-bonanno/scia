# Testing

| Layer       | Command                    | What it proves                                                                                               |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Unit        | `npm run test:unit`        | Rules: the domain, desktop engines, extension logic, React components                                        |
| Integration | `npm run test:integration` | The downloader against a real HTTP host and a real folder; main's ear on the engine against a real HTTP host |
| Feature     | `npm run test:feature`     | The engine's API: tokens, scopes, status codes                                                               |
| All         | `npm test`                 | The three above                                                                                              |

## Writing a spec

- The name of a spec is the rule it holds: `'never overwrites a file already in the folder'`.
- One behaviour per spec; arrange, act, assert, with a blank line between.
- Integration specs compare **bytes** (`Buffer.compare`), not counters that could agree by accident.
- No fixed sleeps. Wait for a state with `until(() => …)` (`apps/server/src/testing/scratch.ts`); inject delays (`retryDelayMs`). A wait that is the case itself is not a wait for an outcome — a reader that stays away from a host, the stretch over which a rate is measured — and says so where it stands.
- Each spec gets its own temp folder and its own host (`startRangeServer`), and removes them.
- A host that misbehaves is an option of `startRangeServer` (`drops`, `ranges: false`, `status`, `announcesLength: false`), not a mock of `http`.
- A service Scia connects to is a local host as well: `startAllDebridServer` (`apps/server/src/testing/alldebrid-server.ts`) answers as AllDebrid's documentation says, and refuses or misbehaves when told to. Every key in a spec is made up; no spec and no run uses a real one.
- Never hardcode a Windows path separator in a spec: build paths with `path.join`. CI runs on Linux.

## Proving the real app

Until the E2E suite exists, a change to the shell (boot, window, bridge, quit) or to how the engine is started is proven by hand, and the PR body says what ran:

1. `npm start` — builds everything and launches Electron with `--user-data-dir=.dev-profile --port=47822`.
2. Do the thing; then read `apps/desktop/.dev-profile/logs/main.log`. A healthy-looking window has hidden a dead subsystem before: **read the log**.
3. For a download, point it at a local host rather than someone's server. For a service, start the simulated one on a port and launch with `--alldebrid-api=http://127.0.0.1:<port>`: the engine takes an address on this computer and no other. The key typed in such a run is one the simulated service was given, never a real one.
4. To drive the window from a script, add `--remote-debugging-port=<n>` and speak the DevTools protocol to it. Such harnesses are not committed.
5. To close the window as its X does, send it the system's close message (`(Get-Process -Id <pid>).CloseMainWindow()` on Windows): the page's own `window.close()` and the protocol's `Browser.close` are different roads, and neither is the person's.
