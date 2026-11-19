# Scia — roadmap

The state is the real one: an item is "done" only if it was verified in the real app.

## M0 — Foundations (done)

- Monorepo, tooling, hooks, tests on four layers.
- Repository on GitHub with GitFlow, checks on PRs, automatic versions and release notes (semantic-release). The Windows installer builds locally, and the app it is made from starts and quits cleanly on a scratch profile; the installer itself has not been run. **No installer has been produced by CI yet, and the Linux packages have never been built** (`docs/development/release-flow.md`, "Not there yet").
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
- **Pages, playlists and channels** (#8): the address of a page, a playlist, a channel or a profile is expanded into the videos it lists, following its pages to the end; the list is shown to confirm, then downloaded. A private playlist, or anything else behind the person's own login, is read with the session of their own browser, on the explicit per-site choice above. How sites are read is an ADR to write: yt-dlp is the candidate (thousands of sites, kept up to date by its community), against writing and maintaining a reader per site; the ADR has to answer the objection ADR 0001 made to aria2 — an external binary to ship, update and supervise per platform. **Needs the owner's word on the "Respect the hosts" principle before it is built** (see the question at the end). It also depends on the adaptive streams and on the session hand-over of this milestone.
- A fallback port, and the extension finding the app by itself, when 47821 is taken.

## M3 — Integrations: debrid services

M3 does not wait for M2: a hoster link pasted into Scia needs nothing from it. Only the link sent by the extension leans on an extension that has not been tried in a browser yet.

Integrations arrive one at a time. Each is visible in three places: an **Integrations** section in Settings that lists the services and shows which are connected; the Integrations table in the README; the release notes of the version that brings it (`feat(integrations): …`).

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

**May Scia download what a site lets a person play but forbids them to download?** From a public page as from the person's own account. #8 needs the answer before it is built, and carries this same question until it has one.

The principle today (`CLAUDE.md`, "Respect the hosts"), whole: "Scia downloads what the person has the right to download. No DRM circumvention, no evasion of a site's access controls, connection counts within the limits in settings. A feature that only makes sense against a host's will is not built."

What #8 asks for meets it in two places. The videos of a playlist or of a profile are ones the person can already play; but most streaming sites forbid downloading in their terms, and the first and the last sentence of the principle may be read to cover that. And the tools that read such sites can do more than read: yt-dlp, the candidate, can also work around geographic restrictions, which both answers refuse.

**Yes.** The principle becomes, in `CLAUDE.md`:

> **Respect the hosts.** Scia fetches what the person can already reach: a public file, or what their own account plays in their own browser. No DRM circumvention, no way around a paywall, a login the person does not have, or a geographic restriction. Connection counts within the limits in settings.

and the first line of "What it is not" in `vision.md`:

> It does not circumvent protections: no DRM, no way around a paywall, a login the person does not have, or a geographic restriction. Scia fetches what the person can already reach.

#8 is built inside that line.

**No.** The principle stays as it is. #8 is closed, its item leaves M2 and the clause on pages, playlists and channels leaves `vision.md`. The same reading then has to be applied to what stands on the same line: the media the extension detects in a page (M0, written), the adaptive streams and the downloads behind a login of M2. Each would be kept only for sites that allow downloading, or dropped.

This section is removed once the answer is recorded in `CLAUDE.md`, `vision.md` and #8.
