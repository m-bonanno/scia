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
- #58: a paused bar gets a dimmer tone of its own, a token darker than the accent in every theme and variant, held by the contrast spec. Changed on 23 November 2026.
- #66: a placeholder at the contrast of text carries the key's field ("Paste your API key"), and that is the rule for every field that has nothing else.
- #102: after Linux, with a design document first (what it does that yt-dlp does not), before any decision to build.
- #134: what is on the clipboard when the reading starts is never taken — the clipboard's formats are read before it is called empty, or the reading waits longer — and ADR 0012's exception goes.
- #143: while notices are shown, the list and Settings get bottom padding as tall as the stack, so that what takes the focus scrolls above them.
- #146: with Settings closed before the code is confirmed, Scia keeps waiting for the code's ten minutes and connects when it is confirmed, saying so with a notification; ADR 0013's point 3 is amended by the PR that does it.
- #150: a magnet of one file goes straight into the download folder, with no folder of its own; the field's placeholder names magnets ("Paste links or magnets") only while a service is connected.
- #159: the popover's note names the remedy, "Pause your downloads to restart now."; the question keeps naming only the version it leads to.
- #181: the files of a link that unlocks into several are shown as a list to tick, all ticked; the person unticks what they do not want and starts.
- #168: related fixes filed together may share one branch, which closes all their issues; `git-flow.md` names the case.
- #187: later review rounds are lighter — a fix that touches only specs or the PR body is reviewed by the roles that blocked, and the tech lead reads CI instead of running every gate again after round 1. Not taken for now: the author's self-check, the product manager as the one owner of issue coverage, one suite at a time on the owner's machine. Changed on 24 November 2026: one run of the gates at a time on the owner's machine is the rule (#337).
- #188: `.claude/gotchas.md` becomes an index (one line per rule, by area, the stories in an archive), and the CLAUDE.md files are shortened to their rules, linking to the ADRs.
- M1 whole stays the rule, but for the rows the owner put after it (#34, #39, #42, #55, #57) (#189).
- `v1.0.0` waits for every follow-up settled today on the lines of M1: #13 (its four decisions), #40, #58, #66, #134, #143, #159.
- `v1.0.0` waits for a save of `state.json` not lost while another process holds the file (#151), and a key sealed just before the app was killed, read back (#69).
- `v1.0.0` waits for the magnets of the account (#138) and a magnet copied to the clipboard (#139).
- `v1.0.0` waits for the follow-ups of the code and of magnets (#146, #150).
- `v1.0.0` waits for the page's logo and the app's icon to draw the mark in the same proportions (#88). Not the recommended option.
- `v1.0.0` waits for the two specs in quarantine to be fixed and back in the gates (#43, #162).
- #190: `SECURITY.md` with private vulnerability reporting turned on; Dependabot alerts on; a code of conduct; 3 to 5 issues labelled `good first issue`, written for a stranger. The repository settings are changed on the owner's word, given there. Changed on 22 November 2026: the `good first issue` point is dropped (#221).

## 22 November 2026

- #221: people outside the team contribute issues, and the team opens every pull request. #190's `good first issue` point is dropped; its security policy, Dependabot alerts and code of conduct stay.

## 23 November 2026

- #181, after AllDebrid's documentation showed that one link unlocks into one file, and that several files come only through its redirector ([ADR 0025](../adr/0025-a-link-that-opens-into-several-files.md)):
  - **Which links**: a file host's folder and the links of the protectors and shorteners AllDebrid's redirector opens. The owner chose this knowing that a protector puts a captcha in front of its links, which AllDebrid gets past on its own servers: under "Respect the hosts" that is the service's doing, as a hoster's wait is (#7).
  - **How they are known**: by path shapes Scia keeps as data, in one list (`1fichier.com/dir/…`, `mega.nz/folder/…`); a protector's or a shortener's domain whole. AllDebrid is not asked first about every link.
  - **Where the list shows**: on a row of its own that waits for the person's choice, every file ticked, as a magnet's row does. The chosen files go into a folder named after the link. A link of one file skips the list, as a magnet of one file does (#150).
- #181, on the review of #263 ([ADR 0025](../adr/0025-a-link-that-opens-into-several-files.md)):
  - **A shortener's link that leads to one file** is downloaded as it stands while AllDebrid is connected, when the redirector refuses it or opens it to nothing AllDebrid can get, as before #263.
  - **The sites left out** — multiup.org, sites of pages of links, google.com, example.com — stay out, as the team's choice, not the owner's.
  - **A folder of more than 1,000 files** is not refused whole: the person chooses among its first 1,000 files, and the row says how many were left out.
  - **A folder's link copied to the clipboard** appears in the list as "Ready", like any other copied link, while "Take links from the clipboard" is on and AllDebrid is connected, and opens into its files when the person presses Start.
- #99: picture and sound offered apart are joined only as an mp4 picture in H.264 or AV1 and an AAC sound. The most lines win, and H.264 at equal lines; HEVC never, since Windows plays it only with a paid extension. A webm picture with Opus sound is an issue of its own (#239) ([ADR 0021](../adr/0021-picture-and-sound-joined-into-one-mp4.md)).
- #228: `v1.0.0` waits for a Bunkr album downloaded into a folder of its own. Its reader is Scia's own — a small reader of Bunkr's album and file pages, its domains kept as data in one list — and no second program is shipped: when Bunkr changes its pages, Scia is updated ([ADR 0024](../adr/0024-a-bunkr-album-read-by-scia.md)). Until #214, the album's files are separate downloads in its folder, as a magnet's.
- #228: undoing the XOR Bunkr puts on the link its API answers is within "Respect the hosts": Bunkr's own download page does the same in every visitor's browser, with no account, payment, region or check behind it, so it is no access control ([ADR 0024](../adr/0024-a-bunkr-album-read-by-scia.md), point 4).
- #182, on its measure: the part file is made sparse on Windows, as ADR 0001 said it would be if the measure called for it, with the room on the disk looked at when a download starts instead of reserved, so that a full disk is still said early; the engine gets more disk threads, so that its other disk work never waits behind a write. `v1.0.0` waits for this fix ([ADR 0026](../adr/0026-a-part-file-made-sparse.md)).
- #58, changing the decision of 21 November 2026 after the contrast was computed in every variant: a paused bar gets a tone of its own, darker than the accent and 3:1 or more on its track, in 15 of the 18 variants; Black Tie light, Earth dark and Wood Floor dark keep today's paused bar, lighter than the accent, since "darker" there would be less distinct from a running bar (1.29:1, 1.16:1 and 1.34:1 at best). Wood Floor dark was added from the review of #261. The contrast spec holds the tone on the track and its order against the accent in each variant (#260).
- #257: the update's note says "<version> installs when you quit Scia. Pause your downloads to restart now.", words that stay true once the downloads end. It lands with #159, and does not hold up `v1.0.0` by itself.
- #285: a video's page taken from the clipboard is named by its title, read at once: when it is added "Ready", yt-dlp reads the page for its title alone, and the row shows the title instead of the address — one request to the site for every video copied, including those the person never starts. ADR 0012 gets an amendment, and `vision.md`'s line on whom Scia talks to changes ([ADR 0012](../adr/0012-links-taken-from-the-clipboard.md), "Amendment — the title of a video's page read when it is taken"). `v1.0.0` waits for #285.
- #156: the update's note seen for the first time in a packaged build, and `update-while-downloading.png` with its light twin retaken, in the owner's single sitting on the release candidate of `v1.0.0` — among "The owner's hands" of the roadmap. #258 merges without them, closing #159 and #257.
- #271: people can support Scia with money, through Ko-fi and GitHub Sponsors, in the repository (`.github/FUNDING.yml`, the README) and in the app (a quiet "Support Scia" in Settings, which opens the page in the person's browser). Ko-fi is `ko-fi.com/notsosnake`, and Sponsors the profile of `m-bonanno`, public once GitHub approved it; the repository names both, and Settings opens the Ko-fi page alone, one fixed address. `v1.0.0` waits for it, and opening the Ko-fi page from the installed app joins "The owner's hands" (the owner, on the review of #272).
- #146, on the review of #288 ([ADR 0013](../adr/0013-a-key-that-arrives-by-a-code.md), amendment):
  - **"AllDebrid is connected"** is notified every time AllDebrid connects while Scia's window is not the one in use: a code confirmed in the browser with Settings open too, not only a code left waiting when Settings closed.
  - **A code confirmed while Settings is closed whose key then fails** — refused, blocked, not kept — is said by a notification of its own, "AllDebrid could not be connected" with the reason, under the same rule as the notification of a connection.
- #151, on the review of #297: the specs are enough. The two Windows integration specs of the store, run by CI's Windows job, hold a save while `state.json` is held open, and the gate line of `v1.0.0` is ticked on them. The real app with `state.json` held by another program stays under "Not seen" in evidence.md, and is not part of the owner's sitting.
- #299: `v1.0.0` ships for Windows only, and macOS becomes a milestone of its own after it, as Linux is. Logged on 24 November 2026, with what the owner decided of it that day.

## 24 November 2026

- #310, the README as the project's front window, its points chosen as multiple-choice questions:
  - **The default labels** `good first issue` and `help wanted`: deleted, both. No issue or PR carried either.
  - **The repository's settings** are changed on the owner's word, given there: the topics, the homepage set to the latest release, private vulnerability reporting and Dependabot alerts on (as #190 decided). The social preview is uploaded by hand in Settings: GitHub has no API for it.
  - **The code of conduct's channel for reports**: the repository's private reporting, the one `SECURITY.md` names. No address is published. #190's files land with #310's pull request.
  - **The loop of Scia at work** is recorded by CI's E2E run on Windows, as `docs/design/`'s captures are, and lands with #310's pull request. Changed the same day: it was to be recorded by hand on Windows later, in an issue of its own.
- #313, on the review of #312, chosen as a multiple-choice question: **the README's loop** plays two or three times, then stops on its last frame, the three files completed — the motion ends, and what stays is Scia at work. #312 had made it play forever. Twice is the team's choice within it, in #316's pull request: a reader who arrives during the first play sees the second whole.
- #325: one more site, among the most visited for video and read by yt-dlp, joins those whose video pages are taken from the clipboard (`VIDEO_SITES`), by its domain and the shape of one video's page. Its links pasted already downloaded; this site is named in the code alone — no doc keeps a list of the sites.
  - **Its age check** (the owner, on the review of #326): yt-dlp's reader of the site sets, at every read, four cookies of its own under the site's domain, read in yt-dlp's source (#328 names them). The site's "18 or older" disclaimer confirmed that way is allowed: it is the click of the adult who uses Scia. A legal age verification — the United Kingdom's, and any like it — is an access control, and Scia does not evade it ("Respect the hosts"). What each cookie passes on the site today, the disclaimer or a legal verification, has not been seen: #328. The principle is to say it in general words: #331.
- #313, on the review of #312, chosen as a multiple-choice question: **a Beta report** from someone outside the team gets a word of its own in the roadmap's "Proven by", _Report_, linked to its issue — evidence of its own, apart from the owner's _Hand_ and from a _Script_.
- #315: **the map of modules** leaves `apps/server/CLAUDE.md`, and nothing else of the file with it: a session rebuilds it from `apps/server/src`, and the file is loaded by every session that works under `apps/server`.
- #156: until `v1.0.0`, every capture of `docs/design/` taken by hand that a PR makes stale goes to #156 without asking the owner each time, and is retaken there once, in the owner's sitting on the release candidate. The captures CI's E2E job takes are still retaken in the PR that changes them. It widens the exception of 23 November 2026 for the logo of #88, and is the fourth to the renderer's rule that a PR retakes the captures it changes (`apps/renderer/CLAUDE.md`).

- #337, the team's flow, after a day of five sessions at once — a load average up to 210, four or five review rounds per PR, a conflict in this file at nearly every merge ([`git-flow.md`](../development/git-flow.md), "Work in parallel"; [`review-flow.md`](../development/review-flow.md), "Rules"):
  - **At most two sessions at once**, and a second only for work that touches other files; PRs on the same area one after another.
  - **The local gates with `SCIA_TEST_WORKERS=2`**, one run at a time — a change of 21 November 2026, when #187 left one suite at a time on the owner's machine out.
  - **A session stops only its own processes**, by their id — never `pkill -f` on a pattern other sessions' processes share.
  - **A wording point raised after the approving verdict** goes into a follow-up issue, not into a commit after the approval.
- #13, the tray, to build:
  - **A second launch during a quit** is told by a system notification: "Scia is still closing. Open it again in a moment."
  - **The window closed while Scia starts**, with downloads waiting from the last session: Scia stays in the tray and goes on with them, as a close with downloads waiting does once started.
- #63: `v1.0.0` waits for one write of `state.json` for the state changes that come together.
- #307: `v1.0.0` waits for main's json files saved when another program has them open, as `state.json` is (#151), with the engine's files that rename into place the same way.
- #294: a code confirmed while Settings is open with the browser in front, whose key then fails, **keeps its notification** — a notification too many rather than one missing, as Scia's rule is elsewhere. Nothing changes in the code.
- #315, from the trial on #302: the product manager and the product designer **keep the session's model**. On that PR the product manager on Sonnet approved where the session's model found a blocking defect. `.claude/agents/` stays as it is.
- #314, whether GitHub's agents take part in the team's work: **not now**. The team works as today, and this can be reconsidered later. The owner's notes on housekeeping and on a few dollars a month stay on the issue, not a decision.
- #324: Dependabot's alert #2, the minimatch inside npm, **dismissed as a tolerable risk**: npm's own copy, used at development time only, never shipped. Done the same day through the API. Dropping the override once nothing asks for a vulnerable version stays on #324.
- #327, what a _Report_ proves in the roadmap's "Proven by":
  - **A _Report_ alone does not make an item done**: it is evidence of its own, beside the owner's _Hand_ or a _Script_, which an item needs to be ticked.
  - **Between a _Report_ and a _Script_, the _Script_ is the stronger proof**: it runs again on the app built from the repository.
  - **A "No" report on an item already ticked opens a bug** with the report's evidence; the item stays ticked until the bug confirms it is broken.
- #332, the repository's code security, set by the owner and read back through the API: CodeQL's default setup and Secret Protection with push protection on; Copilot Autofix, the AI Scan features and Agentic autofix off ([`git-flow.md`](../development/git-flow.md), "Repository settings"). **CodeQL's checks become required after a burn-in** — ten green runs, as `testing.md`'s "Burn-in" says for a new job — then are added to the protection of `develop` and `main`.
- #134, the clipboard's ready rows, to build:
  - **A "Ready" row does not count under "In progress"**: it counts under "All" only; "In progress" shows what moves.
  - **"Start all"** is not drawn under the "Completed" filter, and stops looking like a fourth filter tab: a button's style of its own, apart from the tabs.
  - **One wording, "Remove from list"**, on a ready row as on a finished one: the file on disk is never touched.
  - **A ready row keeps the download folder of the moment it was copied**, as every download keeps the folder it was added with: a change in Settings before its Start does not move it.
- #43: the speed limit's menu **rounds whole values** — "1 MB/s", "50 MB/s" — and shows a decimal only where one is needed ("1.5 MB/s").
- #282: a protector's or a shortener's link that fails because the account's premium lapsed, the key is refused or AllDebrid does not answer is **fetched as it stands**, as one AllDebrid gives nothing for already is: ADR 0025's "a link that downloaded before #181 downloads still" holds.
- #296, a copied link's ready row, to build:
  - **A file host's link copied to the clipboard is named at once**, with a service connected, from AllDebrid's `link/infos` (which consumes no traffic), as a video's page is read for its title: one request per copied link, and the row shows the file's name before its Start. The integration's row in [`integrations.md`](./integrations.md) is to say what is then sent, and when.
  - **A ready row with a title also shows its site**: "Ready · youtube.com" (#209).
- #323, a change of what #241 asked ("its retry"): **a refused join falls back by itself, in the same run**, to the best one file or the stream, without stopping for Retry. ADR 0021 is to be amended with it.
- #329: **"Clear completed" clears exactly the downloads it counted** — what the person saw — not one that completed while the request was on its way: a body on the route names them.
- #321: **a notice told again while it is still on screen is announced again** to a screen reader (#336).
- #299, macOS, after the decision of 23 November above: **Linux comes first** after `v1.0.0`, then macOS; **the Apple Developer account is decided when macOS work starts**, with an ADR, as "Zero infrastructure cost" asks — no cost before.
- #274: the `Referer` and `Origin` of `get.bunkrr.su` that Scia's reader of Bunkr sends to Bunkr's API are **within the ruling of #228**: the request Bunkr's own page makes from the person's browser, not an access control got past. The reader's rules — the XOR reading, these headers — go into "Respect the hosts".
- #331: "Respect the hosts" in `CLAUDE.md` says the rulings of 24 November in general words: a site's "18 or older" disclaimer allowed and a legal age verification never evaded (#325), the requests of Scia's own readers those the site's own page makes (#274), a challenge never solved by them, and what a reader of yt-dlp does by itself at a read, beyond what Scia tells yt-dlp, being yt-dlp's business (#333) — a legal age verification aside, which #328 is to settle. Written by #337.
- #333: **what yt-dlp's readers do at a read, a challenge solved included, is yt-dlp's business**, as for everyone who uses yt-dlp; Scia itself solves nothing. The rule of Scia's own reader of Bunkr stays: a challenge, Cloudflare's too, is never solved, and the link fails `ALBUM_REFUSED` ([ADR 0024](../adr/0024-a-bunkr-album-read-by-scia.md)). Asked whether solving one would bring trouble, the owner answered yes: a challenge exists to tell a program from a person, so solving it is the evasion the principle forbids, and it would take a headless browser or a solving service — a new dependency and an ADR — and an arms race with the site. Nothing changes in the code. The principle says it within the limits #331's line gives.
- #328: `v1.0.0` **does not wait** for what yt-dlp's reader of one site does with its four cookies. The issue stays open, with `needs-owner`.

## Undated in the roadmap

The roadmap gave these without a date; the issue holds it.

- The extension is tried in Chrome and Brave first, then Edge (#23).
- Until the extension is published, Settings does not offer the code that pairs it: a code for something nobody can install; the engine keeps it (#152).
- The Linux job of the Release workflow is off until Linux is tried (#28).
- The shipped yt-dlp is brought up to date by Scia from yt-dlp's signed releases on GitHub, at most once a day, only while no download runs or waits (#100, [ADR 0011](../adr/0011-yt-dlp-kept-up-to-date.md)).
- The E2E spec of a copied magnet runs in CI only, with the clipboard answered in main, and no run that opens Electron's windows is made on the owner's machine for it (#139).
- A page of a known site that plays no video is saved as it stands. Decided on #89 while the owner was away; the owner's to reverse.
