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
- **`window.scia` is the whole bridge, and it stays tiny**: the API token, the version, the platform, `revealDownload(id)`, `openDownload(id)`. Main answers a channel only through `MainWindow.answer(name, handler)`, which refuses any sender but the app's page. Adding a member means editing, in one PR: the preload, the main handler, `BridgeChannel` in `@scia/contracts/bridge`, and the renderer's `SciaBridge`. Never a generic `invoke(channel, …)`.
- **Main never takes a path or a URL from the page.** The page names a download by id; main asks the engine for its file (`engine/download-location.ts`) and only then calls `shell`.
- **`ipcMain.handle` only.** No `sendSync`.
- **The engine's environment is a whitelist** (`engine/server-env.ts`). Never spread `process.env` into a child.
- **Supervision** (`engine/server-supervisor.ts`): the window follows the engine once it says `ready`; an engine that exits by itself is started again with a growing wait; after too many failures in a row the person is told, with the log's path.
- **Closing never hangs**: the window hides at once, the engine is asked to stop and write its state, and is stopped anyway after `STOP_LIMIT_MS`.
- **Closing the window is a question, not an order** (`engine/close-policy.ts`). `MainWindow` prevents every close and hands it to main. The window **hides at once**; then main asks the engine once what it is doing, with a bounded wait, and Scia stays hidden while downloads are running or waiting **and** a tray exists, and quits otherwise — also when the engine says nothing in time. One decision at a time, and none once a quit has begun.
- **A quit never goes through the window.** The `before-quit` handler is registered before the first wait of `boot`, so it exists before anything that can ask for a quit (the tray, the system); it refuses Electron's own quit every time, stops the engine, and ends the process with `app.exit`. Closing or destroying the window to quit would be cancelled by the close handler and asked again, in a loop.
- **The tray asks, it never polls** (`tray.ts`, `engine/tray-presentation.ts`, `engine/download-activity.ts`): what the engine is doing is read when the window closes and, on Windows and macOS, when the pointer reaches the icon. **Read an Electron event's `@platform` before relying on it**: `mouse-enter` does not exist on Linux, where the tooltip keeps what it was given at the last close. `createSystemTray` answers `undefined` only when the tray cannot be made (its icon is missing); on a Linux desktop that draws no tray the object exists and shows nowhere, and Electron does not say — there, starting Scia again is the way back to the window, and Linux stays untried (#13).
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
