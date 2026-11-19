# Scia — roadmap

The state is the real one: an item is "done" only if it was verified in the real app.

## M0 — Foundations (done)

- Monorepo, tooling, hooks, tests on four layers.
- Repository on GitHub with GitFlow, checks on PRs, automatic versions and release notes (semantic-release). The Windows installer builds and the packaged app starts. **The installers attached to stable releases have not been produced by CI yet, and the Linux packages have never been built.**
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
- **Pages, playlists and channels**: the address of a playlist, of a channel or of a profile is expanded into the videos it lists, following its pages to the end; the list is shown to confirm, then downloaded. A private playlist, or anything else behind a login, is read with the session of the person's own browser, on the explicit per-site choice above. To be decided in an ADR: extraction is delegated to yt-dlp (thousands of sites, kept up to date by its community) rather than written site by site.
- A fallback port, and the extension finding the app by itself, when 47821 is taken.

## M3 — Integrations: debrid services

Integrations arrive one at a time. Each one is visible in three places: an **Integrations** section in Settings that lists the services and shows which are connected and working; the list of integrations in the README; the release notes of the version that brings it (`feat(integrations): …`).

- **AllDebrid, connected once in the settings** (API key kept by the operating system). From then on **a hoster link pasted into Scia, or sent by the extension, is recognised, unlocked and downloaded automatically**, with nothing else to do — as a direct link would be.
- A download that went through a service says so in its row.
- A link that expires during a long download is unlocked again without losing the bytes.
- A link that unlocks into several files shows the list before downloading.
- A hoster link without a connected service says so, and says what to do.
- Magnets through AllDebrid.
- A second service, to prove the abstraction holds.

## M4 — Organisation

- Categories and rules (a folder per kind or per site).
- Scheduling.
- Integrity checks (checksums) and archive extraction.
- Proxy.
- History with search: the moment to move from `state.json` to a database.
