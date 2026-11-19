# Testing

| Layer       | Command                    | What it proves                                                        |
| ----------- | -------------------------- | --------------------------------------------------------------------- |
| Unit        | `npm run test:unit`        | Rules: the domain, desktop engines, extension logic, React components |
| Integration | `npm run test:integration` | The downloader against a real HTTP host and a real folder             |
| Feature     | `npm run test:feature`     | The engine's API: tokens, scopes, status codes                        |
| All         | `npm test`                 | The three above                                                       |

## Writing a spec

- The name of a spec is the rule it holds: `'never overwrites a file already in the folder'`.
- One behaviour per spec; arrange, act, assert, with a blank line between.
- Integration specs compare **bytes** (`Buffer.compare`), not counters that could agree by accident.
- No fixed sleeps. Wait for a state with `until(() => …)` (`apps/server/src/testing/scratch.ts`); inject delays (`retryDelayMs`).
- Each spec gets its own temp folder and its own host (`startRangeServer`), and removes them.
- A host that misbehaves is an option of `startRangeServer` (`drops`, `ranges: false`, `status`, `announcesLength: false`), not a mock of `http`.
- Never hardcode a Windows path separator in a spec: build paths with `path.join`. CI runs on Linux.

## Proving the real app

Until the E2E suite exists, a change to the shell (boot, window, bridge, quit) or to how the engine is started is proven by hand, and the PR body says what ran:

1. `npm start` — builds everything and launches Electron with `--user-data-dir=.dev-profile --port=47822`.
2. Do the thing; then read `apps/desktop/.dev-profile/logs/main.log`. A healthy-looking window has hidden a dead subsystem before: **read the log**.
3. For a download, point it at a local host rather than someone's server.
4. To drive the window from a script, add `--remote-debugging-port=<n>` and speak the DevTools protocol to it. Such harnesses are not committed.
