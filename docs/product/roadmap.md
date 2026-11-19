# Scia — roadmap

The state is the real one: an item is "done" only if it was verified in the real app.

## M0 — Foundations (done)

- Monorepo, tooling, hooks, tests on four layers.
- Repository on GitHub with GitFlow, checks on PRs, automatic versions and release notes (semantic-release). The Windows installer builds locally and the packaged app starts and quits cleanly on a scratch profile. **The installers attached to stable releases have not been produced by CI yet, and the Linux packages have never been built.**
- Engine: downloads over several connections with dynamic segmentation, pause and resume, a queue, retries after an interruption, safe names that never overwrite, state saved on disk.
- Electron app: a window with its own title bar, supervision of the engine, orderly quit, resume after a restart.
- Interface: adding by paste, a list with the segment bar, filters, basic settings.
- Extension (Chromium): "Download with Scia" menu, media detected in the page, optional hand-over of the browser's downloads. **Written and covered by tests in its logic; not yet tried in a real browser.**

## M1 — Daily use

- Tray icon: closing the window does not stop the downloads (#6). **Written, covered by specs, and verified by script in the real app on Windows** (the window hides, the download goes on, a second launch brings it back, closing with nothing left quits). **Not done until someone has seen it**: the icon on a taskbar, its click, its menu, its tooltip and the notification have never been looked at or pressed, and nothing has been tried on Linux, where the tooltip cannot follow the downloads (#13).
- When the last download of a hidden Scia ends or fails, nothing says so: it stays in the tray. To settle with the notification item below.
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
- **Pages, playlists and channels** (#8): the address of a page, a playlist, a channel or a profile is expanded into the videos it lists, following its pages to the end; the list is shown to confirm, then downloaded. A private playlist, or anything else behind the person's own login, is read with the session of their own browser, on the explicit per-site choice above. How sites are read is an ADR to write: yt-dlp is the candidate (thousands of sites, kept up to date by its community), against writing and maintaining a reader per site. **Needs the owner's word on the "Respect the hosts" principle before it is built** (see the note at the end).
- A fallback port, and the extension finding the app by itself, when 47821 is taken.

## M3 — Integrations: debrid services

Integrations arrive one at a time. Each is visible in three places: an **Integrations** section in Settings that lists the services and shows which are connected and working; the Integrations table in the README; the release notes of the version that brings it (`feat(integrations): …`).

- **AllDebrid** (#7), connected once in Settings (API key kept by the operating system). From then on **a hoster link pasted into Scia, or sent by the extension, is recognised, unlocked and downloaded automatically**, with nothing else to do — as a direct link would be.
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

## Open question for the owner

"Respect the hosts" (`CLAUDE.md`) says: no evasion of a site's access controls, and a feature that only makes sense against a host's will is not built. Expanding a playlist or a profile of a streaming site into its videos, with the person's own session, is not evasion — the person can already play every one of them — but most such sites forbid downloading in their terms. The principle has to say which side of that line Scia stands on before #8 is built. The proposed wording: Scia fetches what the person can already reach — a public file, or what their own account plays in their own browser; no DRM circumvention, no way around a paywall or a login the person does not have, no shared accounts.
