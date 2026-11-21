# Scia — the owner's decisions

The owner's decisions on what Scia does and when, by date, each with its issue. The [roadmap](./roadmap.md) cites this log instead of retelling it; an ADR records a decision's design where there is one. A later decision that changes an earlier one says so, and the earlier one stays as it was.

## 19 November 2026

- The first stable release waits for the whole of M1 and for AllDebrid (#7), whole and tried by the owner with their own key. Changed on 21 November 2026: M1 whole stays the rule, but for the rows the owner put after `v1.0.0` (#189).
- Downloads behind a login: the session comes from the extension only — never a cookie pasted by hand, never a default. The ADR on handing cookies over has to record it.
- Pages, playlists and channels (#8): yes, as JDownloader does, inside the "Respect the hosts" principle as `CLAUDE.md` states it — also where a site's terms forbid downloading what it lets the person play. Sites are read by yt-dlp, shipped with Scia and updated by it, not by a reader per site written here ([ADR 0009](../adr/0009-the-video-of-a-page.md)).
- A debrid service is lawful under "Respect the hosts", and a hoster's wait or daily cap is not an access control Scia evades: the person pays the service, the service fetches the file with accounts of its own, and Scia downloads the link it is given (#7, #46).
- The notification of the last download of a Scia put away in the tray, completed or failed, also says that nothing else is downloading and that Scia is still in the system tray, where it stays until it is quit from its menu (#45).
- After the first stable release: Linux first, before the rest of M2 to M4 goes on; other languages after M4. The order of Linux is changed on 21 November 2026 (#189).

## 20 November 2026

- A link sent by the extension is not part of the first stable release: it goes through the same step, and is tried with the extension in a browser, in M2 (#7).
- The repository is public ahead of the first stable release, so that automatic updates are proven on a beta with installers first (#28).
- The order of M1: the mark on downloaded files and the second press before a program is run (#22); what the review of the tray left that needs no hands (#13); then choosing the folder, the speed limit, the notification when a download ends and automatic updates — alternating, in small PRs, with AllDebrid (#7), so that neither waits for the other to be whole; the rest of the milestone in the same alternation.
- The speed limit is a menu of ready values, with no number to type (#41).
- The notification when a download ends (#45): only while the window is not in front; one for each file, shared by those that end together; a click opens the window; no switch in Settings for now.
- Themes (#52): nine, each one of the "Minimal" palettes of color-hex.com in a dark and a light variant, the default one Black Tie, black and white. The chosen row of a menu's open list stays Chromium's own blue until it can wear the theme.
- The icon and identity of the app: the owner sees it before it is used; it stays in M1, and the first stable release waits for it. The mark is approved as it is, not redrawn (#81).
- The installer is installed silently and started in CI on every PR and in every release, before its files are attached (#92, [ADR 0008](../adr/0008-the-delivery-pipeline.md)).
- Automatic updates (#82, [ADR 0007](../adr/0007-automatic-updates.md)): stable releases, and betas too behind a switch in Settings, off by default; downloaded in silence only while nothing else downloads; installed when the person quits, never a restart during a download, and Scia stays closed afterwards (amended for a restart the person asks for on 21 November 2026, #133); nothing installed when the system ends Scia; every release carries its installer and what the updater reads, betas included.
- The E2E suite runs on the real app, on Windows, on every PR (#91, ADR 0008).
- The video of one page (#89): public videos only, no session ([ADR 0009](../adr/0009-the-video-of-a-page.md)); an HLS stream is made into an mp4 inside Scia, in JavaScript, with no ffmpeg (#98, [ADR 0010](../adr/0010-a-stream-made-into-an-mp4-inside-scia.md)). DRM is refused; HLS with AES-128 whose key the page's player gets is downloaded (#98).
- A hoster link with no service connected says so, and says to connect AllDebrid, instead of saving the host's page as the file (#49, [ADR 0006](../adr/0006-a-file-host-without-a-service.md)).

## 21 November 2026

- Links taken from the clipboard (#128, [ADR 0012](../adr/0012-links-taken-from-the-clipboard.md)): a switch in Settings, "Take links from the clipboard", off by default; files, file hosts' links and known videos' pages added "Ready", not started, with Start, Remove and "Start all"; no link twice; ready rows kept after a restart; a notification of the system says how many were added when the window is not in front.
- The installer refuses to install a version older than the one installed, names both versions, and cannot be forced; the same version installs again, as a repair; a build at `0.0.0` is refused (#172, [ADR 0018](../adr/0018-the-installer-refuses-an-older-version.md)).
- The whole version, small, beside "Scia"; a downloaded update offered there with "Restart now", possible only while nothing runs or waits; Scia opens again by itself after it (#133, [ADR 0015](../adr/0015-a-restart-to-install-an-update.md)).
- "Connect with a code" is the main way to connect AllDebrid in Settings, and pasting a key stays as the other; built before magnets (#136, [ADR 0013](../adr/0013-a-key-that-arrives-by-a-code.md)).
- Magnets through AllDebrid in three pieces, after the code, in this order: a pasted magnet (#137), the magnets of the account (#138), a copied magnet (#139).
- The roadmap (#189): the gate of `v1.0.0` on top (build, the owner's hands, the owner's decisions), one table per milestone, the dated decisions in this file. The seen / not seen detail goes to [`docs/product/evidence.md`](./evidence.md) (#189).
- `v1.0.0` waits for #62 (the window really in use), #115 (the `--inspect` fuse off), #89 with #99 (a video and its sound joined), and #180, #181 (the two parts of #7 left) (#189).
- `v1.0.0` does not wait for #55, #34, #39, #42 (#189).
- The extension's icon moves from M1 to M2, with the extension (#189).
- After `v1.0.0`, in this order: the browser extension (M2), then playlists and channels (#8), then Linux, then the design of Scia's own reader of sites (#102) (#189).
- Live streams (#121) and streams that change partway (#123) come after `v1.0.0`, refused with a clear message until then (#189, #121, #123).
- The owner's checks by hand are made in one sitting, from one checklist, on a beta built as a release candidate (#189).
- #62: `v1.0.0` waits for the fix. A start during which the person goes back to their work is the ordinary case; the fix asks the system which window is in use, which takes a native call and an ADR.
- #115: `enableNodeCliInspectArguments` off in the shipped app; the installer's smoke test drives the installed exe by Chromium's `--remote-debugging-port`, so that the exe tested is the exe shipped. Before `v1.0.0`.
- #89, #99: `v1.0.0` includes the video of a page, with pieces 1 and 2 and piece 3, a video and its sound offered apart joined into one file — without it many sites give only their low quality. How they are joined without ffmpeg (ADR 0010) is #99's design question.
- #55: after `v1.0.0`. The case is rare, and the failure stays on the row.
- #34: after `v1.0.0`. A download folder on a disk without streams is rare; the second press before a program is run stays the defence meanwhile.
- #39, #42: after `v1.0.0`. The settings for all downloads are enough for the first stable release; a control of one download has to earn its place in the row or the field.
- #57: yes, after `v1.0.0` — a click on the notification opens the window, clears the filter that hides the row and scrolls to it.
- #13: with no tray icon drawn, closing the window quits Scia, also with downloads running, and they resume at the next start; a cold start, or a second launch while it loads, shows the window at once in the theme's colours with a line saying Scia is starting; an installer run while downloads run closes Scia with its state saved, and the downloads resume when it starts again; at a shutdown or a sign-out with Scia in the tray, Scia saves its state at once, the downloads resume at the next start, and it does not ask Windows to wait.
- #40: "Change folder" becomes words, a button like the others of Settings ("Change…").
- #58: a paused bar gets a dimmer tone of its own, a token darker than the accent in every theme and variant, held by the contrast spec.
- #66: a placeholder at the contrast of text carries the key's field ("Paste your API key"), and that is the rule for every field that has nothing else.
- #102: after Linux, with a design document first (what it does that yt-dlp does not), before any decision to build.
- #134: what is on the clipboard when the reading starts is never taken — the clipboard's formats are read before it is called empty, or the reading waits longer — and ADR 0012's exception goes.
- #143: while notices are shown, the list and Settings get bottom padding as tall as the stack, so that what takes the focus scrolls above them.
- #146: with Settings closed before the code is confirmed, Scia keeps waiting for the code's ten minutes and connects when it is confirmed, saying so with a notification; ADR 0013's point 3 is amended by the PR that does it.
- #150: a magnet of one file goes straight into the download folder, with no folder of its own; the field's placeholder names magnets ("Paste links or magnets") only while a service is connected.
- #159: the popover's note names the remedy, "Pause your downloads to restart now."; the question keeps naming only the version it leads to.
- #181: the files of a link that unlocks into several are shown as a list to tick, all ticked; the person unticks what they do not want and starts.
- #168: related fixes filed together may share one branch, which closes all their issues; `git-flow.md` names the case.
- #187: later review rounds are lighter — a fix that touches only specs or the PR body is reviewed by the roles that blocked, and the tech lead reads CI instead of running every gate again after round 1. Not taken for now: the author's self-check, the product manager as the one owner of issue coverage, one suite at a time on the owner's machine.
- #188: `.claude/gotchas.md` becomes an index (one line per rule, by area, the stories in an archive), and the CLAUDE.md files are shortened to their rules, linking to the ADRs.
- M1 whole stays the rule, but for the rows the owner put after it (#34, #39, #42, #55, #57) (#189).
- `v1.0.0` waits for every follow-up settled today on the lines of M1: #13 (its four decisions), #40, #58, #66, #134, #143, #159.
- `v1.0.0` waits for a save of `state.json` not lost while another process holds the file (#151), and a key sealed just before the app was killed, read back (#69).
- `v1.0.0` waits for the magnets of the account (#138) and a magnet copied to the clipboard (#139).
- `v1.0.0` waits for the follow-ups of the code and of magnets (#146, #150).
- `v1.0.0` waits for the page's logo and the app's icon to draw the mark in the same proportions (#88). Not the recommended option.
- `v1.0.0` waits for the two specs in quarantine to be fixed and back in the gates (#43, #162).
- #190: `SECURITY.md` with private vulnerability reporting turned on; Dependabot alerts on; a code of conduct; 3 to 5 issues labelled `good first issue`, written for a stranger. The repository settings are changed on the owner's word, given there.

## Undated in the roadmap

The roadmap gave these without a date; the issue holds it.

- The extension is tried in Chrome and Brave first, then Edge (#23).
- Until the extension is published, Settings does not offer the code that pairs it: a code for something nobody can install; the engine keeps it (#152).
- The Linux job of the Release workflow is off until Linux is tried (#28).
- The shipped yt-dlp is brought up to date by Scia from yt-dlp's signed releases on GitHub, at most once a day, only while no download runs or waits (#100, [ADR 0011](../adr/0011-yt-dlp-kept-up-to-date.md)).
- The E2E spec of a copied magnet runs in CI only, with the clipboard answered in main, and no run that opens Electron's windows is made on the owner's machine for it (#139).
- A page of a known site that plays no video is saved as it stands. Decided on #89 while the owner was away; the owner's to reverse.
