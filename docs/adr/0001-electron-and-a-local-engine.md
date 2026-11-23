# ADR 0001 — Electron, with the downloads in a local engine process

- **Status**: accepted
- **Date**: 2026-11-19

## Context

Scia must download any link efficiently, resume, queue, and later go through debrid services (AllDebrid) and assemble adaptive streams. It must look and behave the same on Windows and Linux, take links from a browser extension, and be maintained by one person whose tooling and habits are TypeScript end to end.

## Decision

1. **Electron** for the desktop shell.
2. **The downloads run in their own process** (`apps/server`): plain Node, forked by main as a `utilityProcess`, never importing Electron.
3. **That process speaks HTTP on `127.0.0.1`** (`/api/v1`, Hono): the renderer is served by it and talks to it; the browser extension talks to the same API with a narrower token ([ADR 0002](./0002-browser-extension-pairing.md)). Live state goes to the page as server-sent events.
4. **A download reaches its bytes through a port**, `RemoteSource` (probe, open a range). `HttpSource` is the one adapter today.
5. **State is a JSON file** written whole and renamed into place. The part file on disk is the truth about bytes.

## Alternatives considered

- **Tauri with a Rust engine.** Roughly 150 MB less memory and a much smaller installer. Rejected: two languages and two test stacks for one maintainer; WebKitGTK on Linux renders and performs differently from WebView2 on Windows, against the requirement of one interface; the extension, the page and the engine would share no code. Download speed is bounded by the network and the disk, not by the runtime.
- **aria2 as the engine.** Mature and fast. Rejected: an external binary to ship, update and supervise per platform, with its own state format and no say over how segments are reported to the interface; debrid and stream sources would live outside it anyway.
- **Downloads inside Electron's main process.** Simpler by one process. Rejected: a crash or a stall in a download would take the window with it, and the code could not run under plain Node in tests.
- **IPC instead of HTTP between page and engine.** Rejected: the extension needs a local HTTP endpoint anyway; one protocol with two tokens is less to get wrong than two protocols.
- **SQLite for state.** Not yet: a few hundred records fit a JSON file. `StateStore` is the seam for the day history, search or statistics need a database.

## Consequences

- The engine runs headless in tests and in `npm run dev`; the real Electron app is needed only to prove the shell.
- Memory is Electron's: acceptable now, and closing the window while the engine keeps running (roadmap) will give most of it back.
- AllDebrid becomes a step that turns a hoster link into direct links before the queue, plus possibly a `RemoteSource` decorator that re-resolves an expired link; HLS becomes another `RemoteSource`. Neither changes the manager or the task.
- **Open, to be measured before M1 closes**: on NTFS the part file is extended to its full size up front, and a first write far into a multi-gigabyte file may wait while Windows zero-fills the gap. If the measure says so, the part file is marked sparse on Windows.
  - _Amended by #182, 23 November 2026:_ measured, and it says so. A 32 GiB file on an NVMe SSD wrote nothing for 32 s, and the engine's other disk work waited as long; a 4 GiB file on a USB hard disk, over 45 s ([evidence](../product/evidence.md#zero-filling-on-ntfs)). The part file is made sparse on Windows, its room on the disk looked at instead of reserved, and the engine given a disk thread for every write it can have at once: [ADR 0025](./0025-a-part-file-made-sparse.md).
- **Open**: the API token reaches the page as a process argument, readable by other processes of the same user. Accepted for now: anything running as the user can already read the user's files.
