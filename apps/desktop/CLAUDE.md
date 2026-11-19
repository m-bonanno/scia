# Scia — Desktop CLAUDE.md (`apps/desktop`)

Loaded when working under `apps/desktop/`. **Extends** the root `CLAUDE.md`; wins for Electron-shell work.

## Process model

```
main (Electron: lifecycle, supervision, the window, the tray, the shell's file manager)
 ├─ utilityProcess → apps/server (Hono on 127.0.0.1:<port>, the downloads)
 └─ BrowserWindow → loads http://127.0.0.1:<port>/ (renderer served by the engine)
       └─ preload (sandboxed, CommonJS) → window.scia
```

## The rule that shapes everything: pure engine + thin IO adapter

| Piece       | Holds                                                                                    | Tested by                  |
| ----------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| **Engine**  | decisions with zero Electron: restart backoff, paths from a root, argv, the env, colours | Vitest unit, no Electron   |
| **Adapter** | the IO the engine describes: `utilityProcess.fork`, `BrowserWindow`, `shell`             | the real app (`npm start`) |

**`src/engine/**` never imports `electron`** — ESLint enforces it. A new capability = engine + spec first, adapter second, wiring in `main.ts` third.

## Hard rules

- **Security defaults are non-negotiable**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, no `webviewTag`. Navigation away from the app's origin is blocked and every `window.open` denied. The session refuses every permission except `clipboard-sanitized-write` for the app's own origin (`engine/page-permissions.ts`). The packaged exe sets its fuses in `electron-builder.yml`.
- **The preload is CommonJS.** A sandboxed preload cannot be ESM — it is silently not loaded. Keep its output `.cjs`.
- **`window.scia` is the whole bridge, and it stays tiny**: the API token, the version, the platform, `revealDownload(id)`, `openDownload(id)`, `chooseDownloadFolder()`. Main answers a channel only through `MainWindow.answer(name, handler)`, which refuses any sender but the app's page. Adding a member means editing, in one PR: the preload, the main handler, `BridgeChannel` in `@scia/contracts/bridge`, and the renderer's `SciaBridge`. Never a generic `invoke(channel, …)`.
- **Main never takes a path or a URL from the page.** The page names a download by id; main asks the engine for its file (`engine/download-location.ts`) and only then calls `shell`.
- **The folder new downloads go to is chosen in the system's own dialog, which main shows** (`MainWindow.pickFolder`), and main tells the engine (`engine/download-folder.ts`): the page asks with no argument and reads back what the engine kept. Main answers what became of the folder as a value (`FolderChange` in `@scia/contracts/bridge`: changed, kept, refused) and rejects only for what is not about a folder — an engine that fails or is silent — so that the page never blames a folder nobody chose. One dialog at a time: an ask that arrives while one is open gets that one's answer (`oneAtATime`). The bound on the engine's answers is not a bound on the person, who takes the time they need in the dialog.
- **`ipcMain.handle` only.** No `sendSync`.
- **The engine's environment is a whitelist** (`engine/server-env.ts`). Never spread `process.env` into a child.
- **Supervision** (`engine/server-supervisor.ts`): the window follows the engine once it says `ready`; an engine that does not start the first time is given up on at once; one that exits by itself later is started again with a growing wait, and given up on after too many failures in a row. Either way the person is told, with the log's path, in words that depend on the cause (`engine/engine-failure.ts`): a cause to remove is named only where one is known — the port, for an engine that never started.
- **Quitting never hangs**: the window hides at once, the engine is asked to stop and write its state, and is stopped anyway after `STOP_LIMIT_MS`. An engine still starting when the quit is asked ends with the process, which exits as soon as there is nothing to stop; `ServerSupervisor`, on its own, also stops rather than watches an engine that arrives after `stop()`, and counts no failure once it was asked to stop.
- **Main never waits on the engine without a bound** (`ENGINE_ANSWER_LIMIT_MS`): an engine can be alive and silent, and whatever asked — a close, the tray, "Show in folder" — must get an answer or a refusal.
- **Closing the window is a question, not an order** (`engine/close-policy.ts`, `WindowCloser`). `MainWindow` prevents every close and hands it to main. The window **hides at once**; then main asks the engine once what it is doing, and Scia stays hidden while downloads are running or waiting **and** a tray exists, and quits otherwise — also when the engine says nothing in time. The window hides at every close; the decision is one at a time, none once a quit has begun, and none against a window the person brought back while the engine was asked.
- **A quit never goes through the window.** The `before-quit` handler is registered before the first wait of `boot`, so it exists before anything that can ask for a quit (the tray, the system); it refuses Electron's own quit every time, stops the engine, and ends the process with `app.exit`. Closing or destroying the window to quit would be cancelled by the close handler and asked again, in a loop.
- **The tray asks, it never polls** (`tray.ts`, `engine/tray-presentation.ts`, `engine/download-activity.ts`). The tooltip counts the downloads only while the pointer is on the icon, when the count was just read, and goes back to the plain name when it leaves; an answer that comes back after the pointer has left, or for an earlier visit, is not said (`engine/pointer-tooltip.ts`): a count left there would be stale for whoever reaches the icon another way. **Read an Electron event's `@platform` before relying on it**: `mouse-enter` and `mouse-leave` do not exist on Linux, where the tooltip is the plain name. `createSystemTray` answers `undefined` only when the tray cannot be made (its icon is missing); on a Linux desktop that draws no tray the object exists and shows nowhere, and Electron does not say — there, starting Scia again is the way back to the window, and Linux stays untried (#13).
- **A notice a person needs once is shown once** (`engine/shown-notices.ts`, `notice-file.ts`): the first time the window hides, a notification says where Scia went. A notices file that cannot be read or written never stops anything; the notice is shown again.
- **What main loads by path ships in `dist/assets`**: `build.mjs` copies `assets/` beside `main.cjs` and fails without `tray.png`. The three PNGs (16, 24, 32 px) are rasterised from `assets/tray.svg`: redraw all of them together, never one.
- **Never tune a timeout against a warm start** — the first launch after an install is slow.

## User data

- Everything lives under `app.getPath('userData')`: `engine/` (the engine's state and the extension's token), `logs/`, `notices.json` (the notices already shown). Nothing is written beside the executable.
- **Every run that is not the installed app passes `--user-data-dir=<scratch>`** (and `--port=<n>`), and main honours them: a dev build must never touch the real profile, the real Downloads folder or the installed app's port.

## Packaging

- `npm run dist` builds engine + renderer + main + preload, then electron-builder. `apps/desktop/package.json` stays at `0.0.0`; a release injects the version.
- **No native modules** without an ADR.
- **A zero exit code from a packager is not proof**: install the artefact, launch it on a scratch profile, read its log.
- `npm install` can leave `node_modules/electron/dist` empty while exiting 0. Symptom: missing `electron.exe`. Run `node node_modules/electron/install.js`.
