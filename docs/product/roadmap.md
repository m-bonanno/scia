# Scia — roadmap

## What "done" means

An item is done only when it was seen working in the real app: the built Electron app on Windows, not a test. Every line says how it was seen — by a script driving the real app, or by the owner's hand. Specs and the E2E suite hold what was seen; they do not replace it. What the system draws (a notification, the tray, SmartScreen) and what a hand does are seen by a person, or are not seen. A spec in quarantine holds nothing ([ADR 0019](../adr/0019-specs-in-quarantine.md)).

What was seen of each item, how, and what was not: [evidence.md](./evidence.md). The owner's decisions, by date: [decisions.md](./decisions.md).

In the tables, **Proven by** names the strongest proof: _Specs_ (unit, integration, feature); _E2E_ (the suite on the built app, in CI); _CI install_ (the installer installed silently on a runner); _Script_ (the real app on Windows, driven by a script); _Hand_ (the owner). Beside them, _Report_: a Beta report from someone outside the team that saw the item work, the word linked to its issue — evidence of its own, never in the place of what the owner's hand is to see. **A _Report_ alone does not make an item done**: an item needs the owner's _Hand_ or a _Script_ to be ticked. **A _Script_ is the stronger proof of the two**: it runs again on the app built from the repository. **A report that answers "No" for an item already ticked opens a bug** with the report's evidence, and the item stays ticked until the bug confirms it is broken (the owner, 24 November 2026, #327). **Not seen** is the main gap; the full list is in the evidence.

## The gate of v1.0.0

The first stable release, `v1.0.0`, ships for Windows only, from a public repository. It is tagged when the three lists below are ticked.

### Build

What a line leaves "to be seen" is a line of #334, the owner's sitting ("The owner's hands", below).

- [ ] The window really in use before Scia stays silent (#62): built ([ADR 0020](../adr/0020-the-window-in-use-asked-of-windows.md)), to be seen by hand (#13).
- [x] The `--inspect` fuse off in the shipped app, and the installer's smoke test driving it by the page's debugging port (#115).
- [ ] A video and its sound offered apart, joined into one mp4 (#99), piece 3 of the video of a page (#89), and a join refused falling back to one file or a stream (#241): built ([ADR 0021](../adr/0021-picture-and-sound-joined-into-one-mp4.md)), to be seen on a site by the owner on the beta after the merge.
- [ ] A link that expires during a long download, unlocked again keeping the bytes (#180): built and held by specs ([ADR 0022](../adr/0022-a-direct-link-that-expires.md)), to be seen in the app.
- [ ] A link that unlocks into several files, shown as a list to tick: built ([ADR 0025](../adr/0025-a-link-that-opens-into-several-files.md)), held by specs and by CI's E2E (#181, closed by its merge); what is left is to see it in the app and against the real service, whose answer to a folder nobody has seen, in the owner's sitting below (#7).
- [x] #7's README and ADR point: AllDebrid's row in the README's Integrations table (since #275, its section of [integrations.md](./integrations.md), which the README points to), the roadmap, and the port a service plugs into, [ADR 0005](../adr/0005-a-service-resolves-a-link.md), with [ADR 0025](../adr/0025-a-link-that-opens-into-several-files.md) beside it (#180 and #181 landed).
- [x] A key sealed just before the app was killed, read back (#69): built ([ADR 0023](../adr/0023-a-key-said-kept-once-it-can-be-read-back.md)), and proven by the E2E suite in CI — the built app killed right after a connection on three new profiles, each key read back.
- [x] A save of `state.json` not lost while another process has the file open (#151): built (#229), and held by specs on Windows, run by CI's Windows job — `state.json` held open for a moment while a save renames onto it, the save landing, and held throughout, the save given up and logged and the next one landing ([evidence](./evidence.md#a-save-of-statejson-while-another-process-holds-it)). Ticked on them by the owner's decision that the specs are enough (23 November 2026, on the review of #297; [decisions.md](./decisions.md#23-november-2026)): the real app with `state.json` held by another program stays not seen, and is not part of the owner's sitting.
- [ ] One write of `state.json` for the state changes that come together (#63; `v1.0.0` waits for it, the owner, 24 November 2026): to build.
- [ ] Main's json files, and the engine's files that rename into place the same way, saved while another program has them open, as `state.json` is (#307; `v1.0.0` waits for it, the owner, 24 November 2026): built (#340), by one rule for every file Scia renames into place (`renameWhenFree` of `@scia/core`), and held by specs on Windows, run by CI's Windows job — `theme.json`, the account's hosts and the updater's state held open for a moment while a write renames onto them, each write landing; `theme.json` and `notices.json` held throughout, the write given up, logged with the system's code, and the next one landing ([evidence](./evidence.md#mains-files-while-another-program-holds-them)). Not ticked: the real app with a file held by another program is not seen, and whether the specs are enough, as the owner decided for #151, is the owner's (#339).
- [ ] The follow-ups the owner settled on 21 November 2026: the tray's four decisions (#256: built; the window at once held by CI's E2E suite, an installer's close by the installer's smoke test, the end of a session by the E2E suite only for a message after which nothing ends Scia; a real shutdown or sign-out, and what a person sees, to be seen by hand in #13), the folder's button (#276, from #40: "Change…" in words, the path cut at its start; built, held by specs and read in the built app by CI's E2E, which took the captures of Settings; to be seen by a person with the hand in the folder dialog, #40), a paused bar's tone (#260: built, held by specs and read in the built app by CI's E2E, which took its capture; to be seen by a person, in #58), the key's placeholder (#66: built, held by specs and by CI's E2E in both variants; to be seen in the app, with its capture, in #156), the clipboard's first read (#134, #277: built, held by specs and by CI's E2E with the clipboard answered in main; the system's own clipboard to be tried by a person, below), room under notices (#143), the popover's note (#159, #257: built, held by specs; to be seen in a packaged build, with its two captures, in the owner's sitting, #156), a code confirmed after Settings closed, with the notifications of a connection and of a code that connected nothing (#286: built, held by specs and by CI's E2E suite, which read main's asks for the notifications in its log; the notifications as the system draws them to be seen by a person, in #146), a magnet of one file and the field's placeholder (#150, #283: built, held by specs and by CI's E2E, which took again the captures that show the field with AllDebrid connected; to be seen in the app by a person, in #156).
- [x] The page's logo and the app's icon drawing the mark in the same proportions (#88): one drawing, the icon's, in `@scia/contracts/mark`, held by specs; the captures CI takes retaken, the others with #156.
- [x] The specs in quarantine fixed and back in the gates: the speed limit's (#43, #232) and HLS's (#162).
- [x] The wait of zero-filling on NTFS, measured (#182; ADR 0001: before M1 closes): 32 s with nothing written for a 32 GiB file on an NVMe SSD, over 45 s for 4 GiB on a USB hard disk.
- [ ] A large download that starts at once: its part file made sparse, its room looked at instead of reserved, the engine given more disk threads (#182; `v1.0.0` waits for it, the owner, 23 November 2026): built, held by specs and by CI's E2E suite in the built app ([ADR 0026](../adr/0026-a-part-file-made-sparse.md)), measured with the engine's own task; a large file in the app, and on a USB hard disk, to be seen (#265).
- [x] The installer refuses an older version (#172, #177).
- [ ] A video's page taken from the clipboard named by its title, read by yt-dlp the moment it is taken (#285; `v1.0.0` waits for it, the owner, 23 November 2026): built ([ADR 0012](../adr/0012-links-taken-from-the-clipboard.md), amended), held by specs against a stand-in for yt-dlp and, for the row, by CI's E2E suite in the built app; a real site's title to be seen in the owner's sitting below.
- [ ] Every file of a Bunkr album downloaded into a folder of its own, by a reader of Scia's own (#228): built ([ADR 0024](../adr/0024-a-bunkr-album-read-by-scia.md)) and held by specs, and by CI's E2E suite on the built app, against a local host that answers as Bunkr does; to be seen against the real Bunkr (#266).

### The owner's hands

One sitting, from one checklist — #334, where each line names the issue it comes from and is ticked with what was seen — on a beta built as a release candidate:

- [ ] AllDebrid with the owner's real key: a hoster link downloaded to the end, the connection by a code, a pasted magnet and the account's magnets, a file host's folder opened into its files, a protector's link, and a shortener's link to one file (#7, #137, #138, #181).
- [ ] The real clipboard: links, a magnet and a file host's folder copied, and the start of the reading — a picture on it, a link on it while another program holds it open (#128, #139, #181, #277).
- [ ] The tray by hand: the icon, its click, its menu, its tooltip, a notification looked at and clicked; the window as Scia starts; a shutdown, and an installer run, during a download (#13).
- [ ] The installer downloaded by hand through SmartScreen, and run over a previous version with the app started afterwards (#70).
- [ ] The icon on screen: taskbar, tray, Start menu, desktop, Alt+Tab (#199).
- [ ] Windows set to light: the page, the window and its buttons (#58).
- [ ] The mark on a real `.exe` and a document (#33).
- [ ] A hand in the folder dialog (#40) and on the speed menu (#43).
- [ ] The update's note seen in a packaged build, and its two captures retaken (#156).
- [ ] A real site's video, one file and an HLS stream (#89), and the title of a video's page copied, on its "Ready" row (#285).
- [ ] The Ko-fi page opened from the installed app, at "Support Scia" in Settings (#271).
- [ ] A real public Bunkr album, and a Bunkr file pasted by itself (#266).

Checked after the tag, so not part of the gate: a beta updated to the stable (#82).

### The owner's decisions

Settled on 21, 23 and 24 November 2026 ([decisions.md](./decisions.md#24-november-2026)), #228 and #285 joining the gate on 23 November, #63 and #307 on 24 November. Open: #339's two questions on the gate, asked from the review of #338 — whether it waits also for the decisions of 24 November still to build, and whether the lines ticked on other proof (#69 on CI's E2E suite, #151 on specs) stand beside the key's rule that an item needs the owner's _Hand_ or a _Script_. Two can come back with what is found: #328, if a cookie that yt-dlp's reader of one site sets passes a legal age verification (`v1.0.0` does not wait for it), and #269, if the paused bar does not read as intended in the light variants at the sitting.

## M0 — Foundations

| Item                                                                                                     | Issue    | Built | Proven by  | Not seen                                                            | In v1.0.0 |
| -------------------------------------------------------------------------------------------------------- | -------- | ----- | ---------- | ------------------------------------------------------------------- | --------- |
| [Monorepo, tooling, hooks, four test layers](./evidence.md#monorepo-and-tooling)                         | —        | yes   | CI         | —                                                                   | yes       |
| [GitFlow, checks on Ubuntu and Windows, semantic-release](./evidence.md#the-repository-and-its-pipeline) | #90, #83 | yes   | CI         | a red merged commit making no tag; the Linux packages (never built) | yes       |
| [Engine: segments, pause, resume, queue, retries, safe names, state](./evidence.md#the-engine)           | —        | yes   | Specs, E2E | see evidence                                                        | yes       |
| [Electron app: own title bar, supervised engine, orderly quit, resume](./evidence.md#the-electron-app)   | —        | yes   | E2E        | see evidence                                                        | yes       |
| [Interface: paste, list with segment bar, filters, settings](./evidence.md#the-interface)                | —        | yes   | E2E        | see evidence                                                        | yes       |
| [Extension (Chromium): menu, media in the page, browser hand-over](./evidence.md#the-extension)          | —        | yes   | Specs      | a real browser                                                      | no        |

## M1 — Daily use

`v1.0.0` waits for this milestone, but for the rows marked "no" ([decisions.md](./decisions.md#21-november-2026)).

| Item                                                                                                                      | Issue            | Built | Proven by                            | Not seen                                                                    | In v1.0.0 |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----- | ------------------------------------ | --------------------------------------------------------------------------- | --------- |
| [Tray: closing the window keeps downloading](./evidence.md#the-tray-icon)                                                 | #6, #13          | yes   | Script                               | the icon, its click, menu, tooltip                                          | yes       |
| [The mark of a downloaded file, and a second press to run](./evidence.md#the-mark-of-a-downloaded-file)                   | #22, #33         | yes   | Script                               | a marked `.exe` or document; a disk without streams; a hand                 | yes       |
| [A file that could not be marked says so](./evidence.md#a-file-that-could-not-be-marked)                                  | #34              | no    | —                                    | —                                                                           | no        |
| [The default folder, in Settings](./evidence.md#the-download-folder)                                                      | #37, #40         | yes   | E2E, Script                          | a hand in the dialog; the packaged app                                      | yes       |
| [The folder of one download](./evidence.md#the-download-folder)                                                           | #39              | no    | —                                    | —                                                                           | no        |
| [Speed limit for all downloads](./evidence.md#the-speed-limit)                                                            | #41, #43         | yes   | E2E, Script                          | a hand on the menu; HTTPS in the app                                        | yes       |
| [The speed limit of one download](./evidence.md#the-speed-limit)                                                          | #42              | no    | —                                    | —                                                                           | no        |
| [A notification when a download ends](./evidence.md#the-notification-when-a-download-ends)                                | #45              | yes   | Script (main's log)                  | a notification looked at or clicked                                         | yes       |
| [The window really in use](./evidence.md#the-window-really-in-use)                                                        | #62              | yes   | Specs, E2E                           | a start by hand, back to another window                                     | yes       |
| [A second failure notified](./evidence.md#a-second-failure-notified)                                                      | #55              | no    | —                                    | —                                                                           | no        |
| [A click on a notification leads to the row](./evidence.md#the-notification-when-a-download-ends)                         | #57              | no    | —                                    | —                                                                           | no        |
| [Clipboard watching (optional)](./evidence.md#links-taken-from-the-clipboard)                                             | #128, #134, #285 | yes   | E2E, Hand                            | a ready row through a service; a real site's title (#285); the packaged app | yes       |
| [Themes of the interface](./evidence.md#themes)                                                                           | #52, #58         | yes   | E2E, Script                          | a Windows set to light; a hand on the menu                                  | yes       |
| [The app's icon, from the mark](./evidence.md#the-icon-of-the-app)                                                        | #81, #199        | yes   | read from the system                 | the icon on screen                                                          | yes       |
| [The installer (NSIS), by hand](./evidence.md#the-installer-by-hand)                                                      | #70              | yes   | CI install                           | a download by hand through SmartScreen                                      | yes       |
| [The installer installed and started in CI](./evidence.md#the-installer-in-ci)                                            | #92, #111        | yes   | CI install, every PR and release     | SmartScreen; a hand                                                         | yes       |
| [The installer refuses an older version](./evidence.md#the-installer-refuses-an-older-version)                            | #172             | yes   | Specs (NSIS), CI smoke, Script, Hand | a person running an older release                                           | yes       |
| [Automatic updates](./evidence.md#automatic-updates)                                                                      | #82              | yes   | Script (installed app)               | a stable taken; a quit by the system                                        | yes       |
| [The version, and a downloaded update offered](./evidence.md#the-version-and-a-downloaded-update)                         | #133, #159       | yes   | E2E, Script (packaged)               | a stable offered; real keys; the note's words (#156)                        | yes       |
| [E2E suite on the real app](./evidence.md#the-e2e-suite)                                                                  | #91              | yes   | CI, nineteen specs                   | the packaged app; a kill mid-download (#108)                                | yes       |
| [The `--inspect` fuse off in the shipped app](./evidence.md#the---inspect-fuse-off)                                       | #115             | yes   | CI install, every PR and release     | a debugger asked for by a hand                                              | yes       |
| [A save of `state.json` while another process holds it](./evidence.md#a-save-of-statejson-while-another-process-holds-it) | #151             | yes   | Specs (integration, on Windows)      | the real app with `state.json` held                                         | yes       |
| [Main's files while another program holds them](./evidence.md#mains-files-while-another-program-holds-them)               | #307             | yes   | Specs (integration, on Windows)      | the real app with a file held                                               | yes       |
| [Zero-filling on NTFS: measured, and a part file made sparse](./evidence.md#zero-filling-on-ntfs)                         | #182, #265       | yes   | E2E, Script (the engine's task)      | a large file in the app; a USB disk with the fix (#265)                     | yes       |
| [A way to support Scia](./evidence.md#a-way-to-support-scia)                                                              | #271             | yes   | E2E                                  | the page opened from the app by a hand                                      | yes       |
| [Clearing completed downloads](./evidence.md#clearing-completed-downloads)                                                | #215             | yes   | E2E                                  | a hand in the app; 169 rows at once                                         | yes       |

## M2 — The whole extension

| Item                                                                                                | Issue     | Built   | Proven by   | Not seen                         | In v1.0.0 |
| --------------------------------------------------------------------------------------------------- | --------- | ------- | ----------- | -------------------------------- | --------- |
| [Tried in Chrome and Brave, then Edge; Firefox](./evidence.md#tried-in-browsers)                    | #23       | no      | —           | —                                | no        |
| [Published in the stores; the pairing code back in Settings](./evidence.md#published-in-the-stores) | #152      | no      | —           | —                                | no        |
| [The extension's icon, from the mark](./evidence.md#the-icon-of-the-app)                            | #293      | no      | —           | —                                | no        |
| [Downloads behind a login, per site](./evidence.md#downloads-behind-a-login)                        | —         | no      | —           | —                                | no        |
| [Video of a page: one file, yt-dlp shipped](./evidence.md#the-video-of-one-page)                    | #89, #97  | yes     | Script      | any site but archive.org         | yes       |
| [Video of a page: an HLS stream](./evidence.md#the-video-of-one-page)                               | #98, #162 | yes     | Specs       | any stream in the app, on a site | yes       |
| [Video of a page: picture and sound joined](./evidence.md#the-video-of-one-page)                    | #99, #241 | yes     | Specs       | a site's pair                    | yes       |
| [Video of a page: yt-dlp kept up to date](./evidence.md#the-video-of-one-page)                      | #100      | yes     | E2E, Script | a real release of yt-dlp         | yes       |
| [A live stream recorded until stopped](./evidence.md#the-video-of-one-page)                         | #121      | refused | —           | —                                | no        |
| [A stream that changes partway](./evidence.md#the-video-of-one-page)                                | #123      | refused | —           | —                                | no        |
| [Adaptive streams (HLS, DASH): detection, quality, assembly](./evidence.md#adaptive-streams)        | —         | no      | —           | —                                | no        |
| [Pages, playlists and channels](./evidence.md#pages-playlists-and-channels)                         | #8        | no      | —           | —                                | no        |
| [A fallback port, found by the extension](./evidence.md#a-fallback-port)                            | —         | no      | —           | —                                | no        |
| [A reader of sites of Scia's own](./evidence.md#the-video-of-one-page)                              | #102      | no      | —           | —                                | no        |
| [A Bunkr album into a folder of its own](./evidence.md#a-bunkr-album)                               | #228      | yes     | Specs, E2E  | the real Bunkr (#266)            | yes       |

## M3 — Integrations: debrid services

M3 does not wait for M2. Integrations arrive one at a time, each visible in Settings, in [integrations.md](./integrations.md) — which the README's Integrations points to — and in its release notes ([evidence](./evidence.md#m3--integrations-debrid-services)). AllDebrid is #7; its real key is the owner's to try.

| Item                                                                                           | Issue            | Built | Proven by                        | Not seen                                      | In v1.0.0 |
| ---------------------------------------------------------------------------------------------- | ---------------- | ----- | -------------------------------- | --------------------------------------------- | --------- |
| [AllDebrid connected by a key](./evidence.md#the-alldebrid-connection-in-settings)             | #47, #66         | yes   | Script, by keys too              | a real key; a hand                            | yes       |
| [A key read back after the app was killed](./evidence.md#the-alldebrid-connection-in-settings) | #69              | yes   | E2E                              | a hand; the packaged app                      | yes       |
| [A pasted hoster link unlocked](./evidence.md#the-unlocking-of-a-pasted-link)                  | #48              | yes   | Script; one real try, unfinished | a download through the real service that ends | yes       |
| ["via AllDebrid" on the row](./evidence.md#via-alldebrid-on-the-row)                           | #48              | yes   | Script                           | paused (specs only)                           | yes       |
| [A link that expires, unlocked again](./evidence.md#a-link-that-expires)                       | #180             | yes   | Specs                            | the app; the real service                     | yes       |
| [A link into several files](./evidence.md#a-link-into-several-files)                           | #181             | yes   | Specs, E2E in CI only            | the app; the real service                     | yes       |
| [A file host's link with no service](./evidence.md#a-file-host-without-a-service)              | #49              | yes   | Script                           | the real list in the app                      | yes       |
| [Connected by a code](./evidence.md#connected-by-a-code)                                       | #136, #146, #286 | yes   | E2E, Script                      | AllDebrid's real page                         | yes       |
| [A pasted magnet](./evidence.md#a-pasted-magnet)                                               | #137, #150       | yes   | E2E, Script                      | the real AllDebrid                            | yes       |
| [The magnets of the account](./evidence.md#the-magnets-of-the-account)                         | #138             | yes   | Script                           | the real AllDebrid                            | yes       |
| [A magnet copied to the clipboard](./evidence.md#a-magnet-from-the-clipboard)                  | #139             | yes   | Specs, E2E in CI only            | the real clipboard; the real app here         | yes       |
| [A second service](./evidence.md#a-second-service)                                             | —                | no    | —                                | —                                             | no        |

## M4 — Organisation

| Item                                                                    | Issue | Built | Proven by | Not seen | In v1.0.0 |
| ----------------------------------------------------------------------- | ----- | ----- | --------- | -------- | --------- |
| Categories and rules (a folder per kind or per site)                    | —     | no    | —         | —        | no        |
| Scheduling                                                              | —     | no    | —         | —        | no        |
| Integrity checks (checksums) and archive extraction                     | —     | no    | —         | —        | no        |
| Proxy                                                                   | —     | no    | —         | —        | no        |
| History with search: the moment to move from `state.json` to a database | —     | no    | —         | —        | no        |

## After the first stable release

In this order ([decisions.md](./decisions.md#21-november-2026)):

1. The browser extension: M2, from the browsers to the stores.
2. Pages, playlists and channels (#8).
3. Linux: the packages built and tried on a clean machine, the tray on a desktop that draws one and on one that does not. The Linux job of the Release workflow is off until then (#28; [evidence](./evidence.md#linux)).
4. The design of Scia's own reader of sites (#102), before any decision to build it.

macOS comes after Linux, a milestone of its own (#299; the owner, 23 and 24 November 2026): how Scia is built, signed or not, and updated there is an ADR's, and the Apple Developer account is decided when its work starts, with that ADR — no cost before. Once it ships, the interface stops naming one platform's keys: the empty list says "press Ctrl+V" (`apps/renderer/src/features/downloads/download-list.tsx`).

After `v1.0.0` too, not ordered: live streams (#121), streams that change partway (#123), a file that could not be marked said on its row (#34), the folder (#39) and the speed limit (#42) of one download, a second failure notified (#55), a notification's click leading to the row (#57), the rest of M3 and M4.

| Item                                                                             | Issue | Built | Proven by | Not seen | In v1.0.0 |
| -------------------------------------------------------------------------------- | ----- | ----- | --------- | -------- | --------- |
| [Linux: AppImage and deb, the tray](./evidence.md#linux)                         | #13   | no    | —         | —        | no        |
| [Other languages (i18n), Italian first, after M4](./evidence.md#other-languages) | —     | no    | —         | —        | no        |
| macOS, after Linux                                                               | #299  | no    | —         | —        | no        |

## Specs in quarantine

Held by no gate until their issue is fixed ([ADR 0019](../adr/0019-specs-in-quarantine.md), #195). None today: the two put there by #195 are back in the gates (#43, #162).
