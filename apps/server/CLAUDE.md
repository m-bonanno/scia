# Scia — Engine CLAUDE.md (`apps/server`)

Loaded when working under `apps/server/`. **Extends** the root `CLAUDE.md`; wins for the engine.

The engine downloads. It is a plain Node process: Electron forks it as a `utilityProcess`, the tests and `npm run dev` run it under Node. **It never imports `electron`** (ESLint enforces it).

```
main.ts            wiring: config → store → manager → Hono on 127.0.0.1
app.ts             the HTTP API (/api/v1), its two tokens, the renderer's static files
download-manager   the queue, the names, the state on disk, what a pause/remove/shutdown means
download-task      one download: connections, ranges, retries, writes
remote-source      the PORT a download reaches its bytes through
http-source        its one adapter today (node:http/https)
state-store        state.json, written whole and renamed into place
origin-mark        the mark a finished file carries of having come from the network
```

## Rules

- **Ports where there is a seam.** `RemoteSource` (probe + open a range) is what AllDebrid, HLS and any future source implement or wrap; `StateStore` is what a database would replace. Do not add a port without a second implementation or a test that needs the seam.
- **The part file is the truth about bytes; `state.json` never claims more than the disk holds.** A checkpoint syncs the file first, then writes the state. A crash re-downloads a little; it never corrupts.
- **A file is never overwritten.** Names are made unique against the folder and against the downloads still on their way there, and checked again when the part file is renamed.
- **A finished file carries its system's mark of what came from the network** ([ADR 0003](../../docs/adr/0003-the-mark-of-a-downloaded-file.md), `origin-mark.ts`): on Windows the `Zone.Identifier` stream, with the zone and never the address the file came from. It is written on the part file before the rename, so the file never stands under its name unmarked. A disk that refuses the stream gets its file all the same, and a `mark_refused` in the log: a download does not fail for a mark.
- **Names from a host are hostile.** They pass through `sanitizeFileName` and lose any path before they touch the disk. A test covers every new source of names.
- **Retry what can heal, not what cannot**: a dropped connection, a 5xx, a 429 retry with backoff; a 404 or a 403 fail at once and say so.
- **`Accept-Encoding: identity` always.** A compressed body does not match the ranges asked for.
- **Two tokens, two scopes** ([ADR 0002](../../docs/adr/0002-browser-extension-pairing.md)): the app's token (new at every launch) opens every route; the extension's token (persisted, shown in settings) opens `EXTENSION_ROUTES` and nothing else. A new route is app-only unless the ADR is amended.
- **Only the engine's own host is answered** (`127.0.0.1:<port>` or `localhost:<port>`), and no CORS header is ever sent: a web page can neither read the API nor reach it under another name.
- **The environment is the configuration** (`config.ts`): `SCIA_*` variables given by main, never a file beside the executable.
- **Errors cross the API as `{ error: { code, message } }`** with a code from `ApiErrorCode`; the text a person reads lives in the renderer.

## Testing

- `*.test.ts` — pure pieces (config).
- `*.int.test.ts` — `DownloadTask`, `HttpSource` and `DownloadManager` against `testing/range-server.ts`, a real HTTP host on a free port, and a temp folder. Compare bytes, not counters.
- `*.feature.test.ts` — the API through `app.request()`: every route's token, scope and status code.
- Timing in tests comes from `until(condition)`, never from a fixed sleep; retry delays are injected (`retryDelayMs`).
