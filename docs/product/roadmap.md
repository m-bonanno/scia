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

**The first stable release waits for the whole of this milestone** (the owner, 19 November 2026), and ships for Windows only: Linux comes after it, below. The order, decided the same day: the mark on downloaded files and the second press before a program is run (#22); what the review of the tray left that needs no hands (#13); then choosing the folder, the speed limit, the notification when a download ends and automatic updates — alternating, in small PRs, with AllDebrid (M3, #7), so that neither waits for the other to be whole; the rest of the milestone follows in the same alternation.

- Tray icon: closing the window does not stop the downloads (#6). **Written, covered by specs, and verified by script in the real app on Windows** (the window hides, the download goes on, a second launch brings it back, closing with nothing left quits). **Not done until someone has seen it**: the icon on a taskbar, its click, its menu, its tooltip and the notification have never been looked at or pressed (#13).
- When the last download of a hidden Scia ends or fails, nothing says so yet: it stays in the tray. Decided (19 November 2026): a notification says it, and Scia stays in the tray until it is quit from its menu. To be built with the notification item below.
- A file Scia downloads is marked as coming from the network — on Windows the zone only, never the address it came from — and a downloaded program asks for a second press before it is run (#22). **Written, covered by specs, and seen in the real app on Windows**: the stream is on the finished file; a double click and a key held down run nothing, they make the button ask; and after the second press Windows itself asks before a marked script is run ([ADR 0003](../adr/0003-the-mark-of-a-downloaded-file.md)). Not seen: a marked program or document (the file run was a script); a disk without streams (held by a spec with a mark that refuses, never tried on a real one); a hand on the mouse and on the keys (the presses were sent by a script). Linux: no mark is written there.
- Choosing the folder, default and per download.
- Speed limit, global and per download.
- A notification when a download ends; "Open" and "Show in folder" are already there.
- Clipboard watching (optional): a copied link is offered.
- Icon and identity of the app, starting from the mark Scia has; the owner is to see it before it is used.
- The Windows installer (NSIS) tried on a clean machine.
- Automatic updates.
- E2E suite with Playwright on the real app.
- To measure: the wait caused by zero-filling on NTFS for very large files (ADR 0001).

## M2 — The whole extension

- Tried in Chrome and Brave first — the owner's choice (#23) — then Edge; a version for Firefox.
- Published in the stores. Each store's policy on downloading media from streaming sites has to be read, not remembered — and before pages, playlists and channels are built, not at the moment of submitting: the media the extension detects, the adaptive streams and #8 all stand on what it says.
- Downloads behind a login: sending the session's cookies, an explicit choice per site. The session comes from the extension only — never a cookie pasted by hand, never a default (the owner, 19 November 2026). The ADR on handing cookies over, which ADR 0002 announces, is still to write and has to record it. So has the ADR on yt-dlp, also to write: yt-dlp can read a browser's cookie store by itself, Scia never asks that of it, and a spec has to hold that.
- Adaptive streams (HLS, DASH): detection, choice of quality, assembly. Unprotected streams only.
- **Pages, playlists and channels** (#8): the address of a page, a playlist, a channel or a profile is expanded into the videos it lists, following its pages to the end; the list is shown to confirm, then downloaded. A private playlist, or anything else behind the person's own login, is read with the session of their own browser, on the explicit per-site choice above. The owner answered the question this item carried (19 November 2026): yes, as JDownloader does, inside the "Respect the hosts" principle as `CLAUDE.md` states it. Decided with it: sites are read by yt-dlp (thousands of sites, kept up to date by its community), shipped with Scia and updated by it, not by a reader per site written here. The ADR is still to write, and has to answer the objection ADR 0001 made to aria2 — an external binary to ship, update and supervise per platform. yt-dlp can do more than the principle allows — it can work around geographic restrictions: Scia never asks it to, and a spec has to hold that. It depends on the adaptive streams and on the session hand-over of this milestone.
- A fallback port, and the extension finding the app by itself, when 47821 is taken.

## M3 — Integrations: debrid services

M3 does not wait for M2: a hoster link pasted into Scia needs nothing from it. Only the link sent by the extension leans on an extension that has not been tried in a browser yet.

Integrations arrive one at a time. Each is visible in three places: an **Integrations** section in Settings that lists the services and shows which are connected; the Integrations table in the README; the release notes of the version that brings it (`feat(integrations): …`).

- **AllDebrid** (#7), connected once in Settings (API key kept by the operating system). From then on **a hoster link pasted into Scia, or sent by the extension, is recognised, unlocked and downloaded automatically**, with nothing else to do — as a direct link would be. It has to be built and proven against a simulated service; the verification with a real account is the owner's, who pastes their own key into Settings. **A question for the owner before the first AllDebrid PR** (#7): whether a hoster's wait or cap is an access control in the sense of "Respect the hosts".
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

## After the first stable release

- Linux: the packages (AppImage, deb) built and tried on a clean machine, the tray on a desktop that draws one and on one that does not — nothing of the tray has been tried there, and its tooltip cannot follow the downloads (#13). Until then Scia is untried and unpackaged on Linux. The Release workflow builds the Linux packages on a stable tag: whether that job waits too is decided with the first release PR.
- The interface in other languages (i18n), a feature of its own. Italian will be the first one added.

## Not planned

- macOS. If it is ever shipped, the interface stops naming one platform's keys: the empty list says "press Ctrl+V" (`apps/renderer/src/features/downloads/download-list.tsx`).
