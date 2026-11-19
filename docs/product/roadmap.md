# Scia — roadmap

The state is the real one: an item is "done" only if it was verified in the real app.

## M0 — Foundations (done)

- Monorepo, tooling, hooks, tests on four layers.
- Repository on GitHub with GitFlow, checks on PRs, automatic versions and release notes (semantic-release). **The installers attached to stable releases have not been produced by CI yet.**
- Engine: downloads over several connections with dynamic segmentation, pause and resume, a queue, retries after an interruption, safe names that never overwrite, state saved on disk.
- Electron app: a window with its own title bar, supervision of the engine, orderly quit, resume after a restart.
- Interface: adding by paste, a list with the segment bar, filters, basic settings.
- Extension (Chromium): "Download with Scia" menu, media detected in the page, optional hand-over of the browser's downloads. **Written and covered by tests in its logic; not yet tried in a real browser.**

## M1 — Daily use

- Tray icon: closing the window does not stop the downloads.
- Choosing the folder, default and per download.
- Speed limit, global and per download.
- A notification when a download ends; "Open" and "Show in folder" are already there.
- Clipboard watching (optional): a copied link is offered.
- Icon and identity of the app; installers for Windows (NSIS) and Linux (AppImage, deb) tried on clean machines.
- Automatic updates.
- E2E suite with Playwright on the real app.
- To measure: the wait caused by zero-filling on NTFS for very large files (ADR 0001).

## M2 — The whole extension

- Tried in Chrome, Edge, Brave; a version for Firefox.
- Published in the stores.
- Downloads behind a login: sending the session's cookies, an explicit choice per site.
- Adaptive streams (HLS, DASH): detection, choice of quality, assembly. Unprotected streams only.
- A fallback port, and the extension finding the app by itself, when 47821 is taken.

## M3 — Debrid services

- AllDebrid: API key kept by the operating system, unlocking of hoster links, renewal of a link that expires during a long download.
- Magnets through AllDebrid.
- Unlockable links recognised when they are added, with the list of files before downloading.
- A second service, to prove the abstraction holds.

## M4 — Organisation

- Categories and rules (a folder per kind or per site).
- Scheduling.
- Integrity checks (checksums) and archive extraction.
- Proxy.
- History with search: the moment to move from `state.json` to a database.
