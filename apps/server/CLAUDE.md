# Scia — Engine CLAUDE.md (`apps/server`)

Loaded when working under `apps/server/`. **Extends** the root `CLAUDE.md`; wins for the engine.

The engine downloads. It is a plain Node process: Electron forks it as a `utilityProcess`, the tests and `npm run dev` run it under Node. **It never imports `electron`** (ESLint enforces it).

```
main.ts            wiring: config → store → manager → Hono on 127.0.0.1
app.ts             the HTTP API (/api/v1), its two tokens, the renderer's static files
download-manager   the queue, the names, the state on disk, what a pause/remove/shutdown means
download-task      one download: connections, ranges, retries, writes
throttle           the speed limit as connections meet it: who waits, and who is woken
remote-source      the PORT a download reaches its bytes through
http-source        its one adapter today (node:http/https)
state-store        state.json, written whole and renamed into place
origin-mark        the mark a finished file carries of having come from the network
```

## Rules

- **Ports where there is a seam.** `RemoteSource` (probe + open a range) is what AllDebrid, HLS and any future source implement or wrap; `StateStore` is what a database would replace. Do not add a port without a second implementation or a test that needs the seam.
- **The part file is the truth about bytes; `state.json` never claims more than the disk holds.** A checkpoint syncs the file first, then writes the state. A crash re-downloads a little; it never corrupts.
- **A file is never overwritten.** Names are made unique against the folder and against the downloads still on their way there, and checked again when the part file is renamed.
- **A finished file carries its system's mark of what came from the network** ([ADR 0003](../../docs/adr/0003-the-mark-of-a-downloaded-file.md), `origin-mark.ts`): on Windows the `Zone.Identifier` stream, with the zone and never the address the file came from. It is written on the part file, before the name is looked at and the file renamed: the file never stands under its name unmarked, and nothing waits between "is the name free?" and the rename. A disk that refuses the stream gets its file all the same, and a `mark_refused` with its id in the log: a download does not fail for a mark.
- **Names from a host are hostile.** They pass through `sanitizeFileName` and lose any path before they touch the disk. A test covers every new source of names.
- **Retry what can heal, not what cannot**: a dropped connection, a 5xx, a 429 retry with backoff; a 404 or a 403 fail at once and say so.
- **`Accept-Encoding: identity` always.** A compressed body does not match the ranges asked for.
- **One speed limit for everything** (`Throttle`, one in `DownloadManager`, over the `Pacer` of `@scia/core`). **A connection reads only against room booked before the read**: before it asks its host for a range it books one read's worth (64 KB, or what is left of its range when that is less) and waits its turn; before every read after that, when what it has booked no longer covers the largest read it has made, it books up to a whole read again. When it is done — finished, failed, paused, removed — it settles: what it booked and did not read is given back. A download that is paused or removed leaves nothing owed. A host is held back by not being read from; no byte that was read is thrown away.
  - **Nothing is read that the limit has not made room for, from the first byte, but for three things, each with its bound**:
    1. when a limit is set or lowered, each connection in the middle of a read finishes that read — one read at most — and pays for it before its next;
    2. a read larger than any its connection has made before passes what was booked by the difference — less than one read over the connection's whole life — and is paid for before the next;
    3. a booking may start up to 50 ms in the past, so that a wait that ends late is caught up: the limit is passed by no more than 50 ms' worth of it, and nothing beyond that is ever caught up. A system's timer may fire fifteen milliseconds late, which under a high limit is many reads' turns.
  - "Read" is what the engine takes from a connection. What the host has sent ahead of that — in the system's buffers and in Node's — is not counted: it is there once for each connection, it is not a rate, and it is how any limit that holds a host back by not reading works.
  - Under a limit the connections of a download open one after the other, as the limit makes room, and a connection's turn comes round every connections × 64 KB ÷ the limit: 40 s at the most Settings allows (160 connections, 256 KB/s). Over an encrypted connection a read is a record of 16 KB: one booking covers four.
  - **A connection held back is not a silent host.** `HttpSource` times a host's silence only while a read is waiting for it — never on the socket, which is quiet whenever Scia is not reading. That timer was also what ended an answer nobody read: a redirect's answer is closed, not drained, and what `open` answers is read at once (`remote-source.ts`).
  - It runs on a clock that never steps (`performance.now`), not the system's: a clock set back an hour would be an hour without a byte.
  - Changing or lifting it wakes whoever is waiting, to book again under the new limit; what was booked with the old one is forgotten. A download that is paused, removed or stopped does not wait on the limit: the wait ends with its signal.
  - **A limit is tried at both ends of the menu, against a host that does not pause, in bytes.** Three shapes of this were wrong, each invisible to the runs made of it: paid after the read, every connection's first read passed unpaid and stayed owed when its download was removed; booked only when nothing was left, the couple of hundred bytes an answer's headers leave of a booking let a whole read through, twice the limit while connections opened — hidden by a test host that paused between pieces; and with a wait before every read and none made up, a download under 25 MB/s got a third of it — hidden by runs that all sat between 256 KB/s and 2 MB/s.
- **`state.json` takes a new setting with a default** (`state-store.ts`): a file written before the setting existed loads, with the default — and so does one whose stored value the bounds of today refuse. A state that does not parse is set aside as `.unreadable` and the engine starts empty — so a setting added without a default, or a bound tightened later, would lose every download in the list.
- **The theme of the interface is a setting** (`theme`, one of `Theme` in `@scia/contracts/theme`; the page patches it), and **the page is served wearing it**: `data-theme` is written on the `<html>` of `index.html` at every request, so the page's first paint is in the theme, with no script and no answer to wait for. A state that names a theme this version does not have loads with the default one.
- **The download folder has a route of its own** (`PUT /settings/download-directory`, the app's token only): main names it after the person chose it in the system's dialog. It is not among the settings the page patches, so no type lets the page send a path. The engine takes an absolute path, keeps it as the system names it (`resolve`), makes the folder, and refuses one it cannot make or write to, leaving the settings as they were. **Writing is proven by writing** — a file of Scia's own made in the folder and removed — never by asking the system: on Windows `access(folder, W_OK)` says yes for every folder that exists. A download keeps the folder it was added with.
- **Two tokens, two scopes** ([ADR 0002](../../docs/adr/0002-browser-extension-pairing.md)): the app's token (new at every launch) opens every route; the extension's token (persisted, shown in settings) opens `EXTENSION_ROUTES` and nothing else. A new route is app-only unless the ADR is amended.
- **Only the engine's own host is answered** (`127.0.0.1:<port>` or `localhost:<port>`), and no CORS header is ever sent: a web page can neither read the API nor reach it under another name.
- **The environment is the configuration** (`config.ts`): `SCIA_*` variables given by main, never a file beside the executable.
- **Errors cross the API as `{ error: { code, message } }`** with a code from `ApiErrorCode`; the text a person reads lives in the renderer.

## Testing

- `*.test.ts` — pure pieces (config), and the throttle on a clock and timers the spec moves.
- `*.int.test.ts` — `DownloadTask`, `HttpSource` and `DownloadManager` against `testing/range-server.ts`, a real HTTP host on a free port, and a temp folder. Compare bytes, not counters.
- `*.feature.test.ts` — the API through `app.request()`: every route's token, scope and status code.
- Timing in tests comes from `until(condition)`, never from a fixed sleep; retry delays and the idle timeout are injected (`retryDelayMs`, `idleTimeoutMs`). A rate is proven against a host that does not pause (`chunkDelayMs` unset) and counted in bytes.
