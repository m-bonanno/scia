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

**The first stable release waits for the whole of this milestone and for AllDebrid (#7) — whole, and tried by the owner with their own key** (the owner, 19 November 2026; whether whole includes a link sent by the extension, untried in a browser, is not decided — asked on #7), and ships for Windows only: Linux comes after it, below. The repository becomes public shortly before it — when this milestone is nearly whole — so that automatic updates are proven on a beta with installers first (#28). The order, decided the same day: the mark on downloaded files and the second press before a program is run (#22); what the review of the tray left that needs no hands (#13); then choosing the folder, the speed limit, the notification when a download ends and automatic updates — alternating, in small PRs, with AllDebrid (M3, #7), so that neither waits for the other to be whole; the rest of the milestone follows in the same alternation.

- Tray icon: closing the window does not stop the downloads (#6). **Written, covered by specs, and verified by script in the real app on Windows** (the window hides, the download goes on, a second launch brings it back, closing with nothing left quits). **Not done until someone has seen it**: the icon on a taskbar, its click, its menu, its tooltip and the notification have never been looked at or pressed (#13).
- A file Scia downloads is marked as coming from the network — on Windows the zone only, never the address it came from — and a downloaded program asks for a second press before it is run (#22). **Written, covered by specs, and seen in the real app on Windows**: the stream is on the finished file; a double click and a key held down run nothing, they make the button ask; and after the second press Windows itself asks before a marked script is run ([ADR 0003](../adr/0003-the-mark-of-a-downloaded-file.md)). Not seen (#33): a marked `.exe`, installer or document (the files run were scripts); a disk without streams (held by a spec with a mark that refuses, never tried on a real one); a hand on the mouse and on the keys (the presses were sent by a script). Linux: no mark is written there.
- A file that could not be marked — on a disk without streams — says so on its row, discreetly (#34). Decided by the owner, not built. Whether the first stable release waits for it is not decided (#34).
- Choosing the folder. **The default one, in Settings (#37): written, covered by specs, and seen in the real app on Windows** — the system's dialog cancelled and then answered, what is added afterwards landing in the chosen folder, the choice kept after a restart. A folder that takes no file, chosen in that dialog, is refused, and Settings says so beside the folder in use. Not seen (#40): a hand in that dialog (a script filled and pressed it); Linux; the packaged app. The folder of one download: not built (#39).
- Speed limit. **For all downloads together, in Settings (#41): written, covered by specs, and seen in the real app on Windows** — a menu of ready values, with no number to type (the owner, 20 November 2026); a download held at the rate chosen, freed when the limit is lifted, held again at another rate without being stopped; three downloads held together under the one limit; against a host that sends as fast as it is read, counted in bytes: three downloads of eight connections at the lowest ready value, within one read of what the limit gives; ten of sixteen at that value, the same, each connection's turn 40 s apart — longer than the engine waits for a silent host — and no request made twice; a download under 25 and under 50 MB/s, the highest, at 99 and 100 % of the limit; a download paused in its stride leaving nothing owed to the next; files that arrive in one read held like the others; the limit kept after a restart and said beside the total speed, while there is a speed to show; a state file written before the limit existed loads. Not seen (#43): a hand on the menu (a script set its value), the keys on it, and the list it opens, which the system draws — in either theme; Settings and the title bar with a limit in the light theme; the row of a download that waits its turn; HTTPS in the app (measured with scripts, not in it); a host that is not local read from this slowly, or going silent; Linux; the packaged app. The limit of one download: not built (#42).
- A notification when a download ends (#45); "Open" and "Show in folder" are already there. Decided by the owner (20 November 2026): only while the window is not in front — read in review as "not the window in use"; one for each file, shared by those that end together; a click opens the window; no switch in Settings for now. For the last download of a Scia put away in the tray — completed or failed — it also says that nothing else is downloading and that Scia is still in the system tray, where it stays until it is quit from its menu (decided 19 November 2026). **Written, covered by specs, and verified by script in the real app on Windows.** The script read main's log: how many downloads ended and how, where the window was, the title main handed the system, how many lines its body had and whether the tray's sentence was among them, and that the system answered "shown". By that: nothing is asked of the system while main takes the window for in front; with the window minimised a download that completes is notified, five that end together share one notification, and one that fails is notified; so is the last download of a Scia put away in the tray, with the tray's sentence; it goes on after the engine is started again; and a Scia left idle for eleven minutes keeps hearing its engine. **Held by specs only**: the names in the body, a window that is shown and not the one in use, a failure as the last download of a hidden Scia. **Not done until someone has seen it**: nobody has looked at a notification or clicked one (#13). **Two limits, each with a decision that waits for the owner**: a window that was shown while another was in use believes it is in front, and Scia is silent until the person clicks into it and away — a start during which they went back to their work; seen under script, not by hand (#62: how to mend it, and whether the stable release waits); a download that fails again within a quarter of a second of being tried again, while something else downloads, is said once if the person leaves the window within two seconds (#55: whether the stable release waits). Whether a click should lead to the download's row is asked on #57. Linux: untried.
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

- **AllDebrid** (#7), connected once in Settings (API key kept by the operating system). From then on **a hoster link pasted into Scia, or sent by the extension, is recognised, unlocked and downloaded automatically**, with nothing else to do — as a direct link would be. It has to be built and proven against a simulated service; the verification with a real account is the owner's, who pastes their own key into Settings. The owner answered the question this item carried (19 November 2026): a debrid service is lawful under "Respect the hosts", and a hoster's wait or daily cap is not an access control Scia evades — the person pays the service, the service fetches the file with accounts of its own, and Scia downloads the link it is given. The first PR of #7 has to say so in the principle.
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

In this order (the owner, 19 November 2026): Linux first, before the rest of M2 to M4 goes on; other languages after M4.

- Linux: the packages (AppImage, deb) built and tried on a clean machine, the tray on a desktop that draws one and on one that does not — nothing of the tray has been tried there, and its tooltip cannot follow the downloads (#13). Until then Scia is untried and unpackaged on Linux. The Release workflow builds the Linux packages on a stable tag today: that job is to be turned off until Linux is tried (the owner's decision), in a PR of its own before the release PR (#28).
- The interface in other languages (i18n), a feature of its own. Italian will be the first one added.

## Not planned

- macOS. If it is ever shipped, the interface stops naming one platform's keys: the empty list says "press Ctrl+V" (`apps/renderer/src/features/downloads/download-list.tsx`).
