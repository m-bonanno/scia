# ADR 0012 — Links taken from the clipboard: main reads, the engine keeps what it knows

- **Status**: accepted; point 4 amended by [ADR 0017](./0017-a-magnet-taken-from-the-clipboard.md); point 3 and its consequence on the three empty reads amended below, "Amendment — the clipboard's formats read before it is called empty" (#134); point 7's "nothing is asked of its host before its Start" amended below for a video's page, "Amendment — the title of a video's page read when it is taken" (#285)
- **Date**: 2026-11-21

## Context

The roadmap's M1 line "Clipboard watching (optional)" asks that a link the person copies anywhere — a browser, a chat, a document — be offered in Scia's list without pasting it. The owner decided what it does (21 November 2026, #128):

- With a switch in Settings, "Take links from the clipboard", off by default, Scia takes the copied links that are files or videos it knows: a link ending with the extension of a downloadable file; a file host's link (the domains AllDebrid lists); the page of a video on a site yt-dlp reads. Any other web page's address is left out, and so is a link to an image. Several links copied at once are all taken.
- They appear in the list in a new state, "Ready", and do not start: each row has Start and Remove, and "Start all" appears at the top while there are ready rows. A link already in the list is not added twice. Ready rows are kept after a restart.
- When Scia is hidden or not in front, a notification of the system says how many were added.
- A video's page is recognised by a list of sites kept in Scia, with nothing asked of the network when a link is copied.

The clipboard is a new kind of input: until now Scia read only what the person pasted into it, what the extension sent, and what a host answered.

## Decision

1. **Main reads the clipboard, and only main** — the page never does (`apps/desktop/src/engine/clipboard-watch.ts`). Electron has no event for a change of the clipboard: main reads its text **every second, and only while the switch is on**. In Electron 44 the read answers a promise, and **a clipboard the system will not open is answered with an empty text**, not a rejection — seen in a run: in a shell whose job limits the desktop, `clipboard.readText()` resolved `''`, while the same shell's own read failed with "Requested Clipboard operation did not succeed". So an empty read is passed over (point 3), as a rejection is. No permission is added to the page: `page-permissions.ts` still refuses every one but `clipboard-sanitized-write`.
2. **Main hears the switch in the engine's events.** The setting is `watchClipboard` (off by default, kept in `state.json`); every list the engine sends on `GET /events` carries it beside the downloads, so main turns the reading on or off the moment it changes, whoever changed it, and again after a restart of the engine — with no member added to the bridge and nothing asked on a timer.
3. **What is on the clipboard when the reading starts was copied for something else, and is not taken** — when the switch is turned on, and when Scia starts with it on. What was there belongs to the turn: until a read of this turn has found text, a read only learns what is there and offers nothing, so a first read that is refused, empty or late changes nothing; a read of a turn before an off and on is dropped. Three empty reads in a row at the start are a clipboard that is empty, and the next text is a copy. Afterwards an empty read is passed over: it tells nothing from the copy before it. Each text copied afterwards is read once, one read or hand-over at a time within a turn, and the count of what one copy added is said once, whatever number of requests it took.
4. **Main keeps no copy of what was copied**: only the digest (SHA-256) of the last text, which tells it from the next. Of a text, only its http(s) links leave main — a password copied goes nowhere — and the log says how many links, never which.
5. **The engine decides which links are taken**, because it holds what decides: main hands it the links on `POST /api/v1/downloads/offered`, with main's token (the extension's does not open it, ADR 0002), at most 200 a request, one copy at a time. The engine keeps a link when:
   - the last name of its path ends with the extension of a video, a sound, an archive or disc image, a document or a program (`fileKindOfName`): not an image, not a web page, and not a name in its query;
   - it is the page of one video on a site of `VIDEO_SITES` (`apps/server/src/offered-links.ts`), by its host — the site's domain or one of its names — and the shape of its path: a site's home, a channel, a list or a search is not one video;
   - it is a file host's: the connected service takes it, or — none connected — its host is on AllDebrid's public list (ADR 0006). The service is given five seconds to say; a link it has not said of by then is not taken.
6. **A link already in the list is not added again**, whatever its row's state, as the same address however its scheme and host were written. Two copies that arrive together add it once.
7. **"Ready" is a state of the contract** (`DownloadStatus.Ready`): the queue never starts it (`nextToStart` takes only `queued`), nothing is asked of its host before its Start, and it has no file on the disk. `POST /downloads/:id/start` starts one, `POST /downloads/start-ready` all of them, in their order and within the queue's limit. A ready row is not a download that needs Scia running: closing the window with only ready rows quits as with nothing to do, and the updater counts Scia as idle.
8. **When links were added while the window is not in front**, main asks the system to say "Added N links, ready to start"; a click opens the window.

## Alternatives considered

- **The page reads the clipboard** (`navigator.clipboard.readText`): it needs a permission the page is refused, works only while the page has the focus, and a hidden page reads nothing — the case the feature is for.
- **The system's own event for a change** (`AddClipboardFormatListener` on Windows): no polling, but a native module, which needs an ADR of its own (`apps/desktop/CLAUDE.md`, "No native modules"), for one system.
- **Asking yt-dlp about every copied page**: it would know every site it reads, but each copy would be a visit to that site — two seconds, and the site told of an address the person may have copied for anything else. Not chosen by the owner.
- **Main deciding which links are taken**: main has neither the file hosts' list nor the services; the engine would be asked anyway.
- **Starting what is copied at once**: the owner chose a row that waits for a press.

## Consequences

- While the switch is on, main reads the clipboard every second, whatever was copied. What is not an http(s) link stays in main's memory for that read alone; the links reach the engine's memory, and those it does not take are dropped there, in no file and no log.
- With no service connected, a copied link that is neither a file nor a known video's page may be the first of a run to need AllDebrid's public list: the same request ADR 0006 describes, with no key and no link.
- A copy whose hand-over failed — the engine restarting, or silent past main's limit — is logged and not offered again until something else is copied: offering it again at every beat would be a request and a warning a second while the engine is down. Pasting it still works.
- The three empty reads cut both ways. A clipboard that holds no text when the reading starts — empty, a picture, files copied in Explorer — makes a link copied within its first three seconds count as what was there: it is not taken. And a clipboard the system will not open for the first three seconds is taken for one that holds no text: what was on it, once it opens, is taken as a copy.
- A hand-over of a turn before an off and on can still be on its way while the new turn hands over a copy: two requests at once, which the engine's dedupe keeps from adding anything twice.
- A video on a site not in `VIDEO_SITES` is not taken from the clipboard; pasted, it is read as before. The list is kept by hand, and a site that changes the shape of its addresses is missed until it is changed.
- A process started under a job that limits the desktop cannot open the clipboard: every read is refused, and nothing is taken. A sandboxed shell on the owner's machine runs so: the E2E spec answers Electron's read in main, as it answers the folder dialog, and the real clipboard is tried by a person.
- Linux has a second clipboard, the selection: Scia reads the clipboard only, and Linux is untried.

## Amendment — the clipboard's formats read before it is called empty (2026-11-23, #134)

The owner decided (21 November 2026, #134): what is on the clipboard when the reading starts is never taken — the clipboard's formats are read before it is called empty, or the reading waits longer — and the exception of the three empty reads goes. `v1.0.0` waits for it.

Point 3 is amended: **until a turn knows what was there, each beat asks the clipboard's formats first, then its text** (`holdsText`, `clipboard.has('text/plain')` in main). The three empty reads are gone, and nothing is called empty by counting.

- **Formats with no text** — empty, a picture, files copied in Explorer — are known at once: the clipboard held no text, and a text read after that answer, in the same beat or later, is a copy, offered as any other. A link copied a moment after the switch is turned on is taken.
- **Formats with text** make the turn wait for the text itself, however long the system keeps the clipboard closed: an empty read is passed over, and the first text read is what was there, not taken.
- **Formats the system will not tell** (a rejection) tell nothing: the beat is passed over, as a refused read is.
- Once the turn knows, the formats are not asked again: each beat reads the text alone.
- Main's log says once a turn whether the clipboard held text when it started (`clipboard_start_known`, `text: true` or `false`), never what.

Why the formats can be believed when the text cannot: Electron 44 builds `has` on the list `clipboard.read()` exposes, whose standard types Chromium takes on Windows from `IsClipboardFormatAvailable`, which answers without opening the clipboard (`electron_api_clipboard.cc` at v44.10.1). A clipboard another program holds open still says it holds text. Under a job that limits the desktop the same call answers no format, as `OpenClipboard` there is refused (seen in a sandboxed shell on the owner's machine, 23 November 2026, from PowerShell): every read of the text there answers `''`, so nothing is taken, as before.

The first consequence about the three empty reads is replaced by these:

- A link copied after the reading has looked is taken, whatever the clipboard held: no wait at the start.
- A clipboard that holds text the system keeps closed is waited for, beat after beat, and what it held is not taken once it opens. A copy made while it stays closed is not seen before it opens, and is then taken for what was there: the safe side, as the owner chose.
- A clipboard whose text is empty — a text format with nothing in it, which few programs write — is one that holds text: the turn waits, and the first text copied after it is taken for what was there and not offered.
- A text copied in the instant between the formats' answer and the read of the text is read with that answer: no text before it, so it is offered; one copied before the formats are asked is what was there.
- What Electron's `has('text/plain')` answers is read in its source and held by specs and the E2E suite, where main answers it as it answers the text; the real clipboard is tried by a person, as for the rest of this ADR.

## Amendment — the title of a video's page read when it is taken (2026-11-23, #285)

A video's page taken from the clipboard showed on its "Ready" row as its address, `youtube.com/watch?v=2ciClG5Vh0U`: nothing said what the video was. The owner decided (23 November 2026, #285): **the title is read at once** — when a video's page is added as "Ready", yt-dlp reads the page for its title alone, and the row shows the title instead of the address; this ADR gets an amendment and `vision.md`'s line on whom Scia talks to changes. `v1.0.0` waits for it. The two other ways the issue offered — reading the title only for a row the person looks at, or showing the site and the video's id instead of the address, with no request — were not chosen.

Point 7's "nothing is asked of its host before its Start" is amended for a video's page; for every other ready row it stands. Each point below is the team's design of the owner's decision, but where it says otherwise.

1. **Which rows** (the owner's decision): a link the engine adds `ready` because it is one video's page on a site of `VIDEO_SITES` (point 5). A file, a file host's link and a folder are not read: they keep the name their address gives until their Start. A pasted page is never ready — it starts at once, and its own read names it (ADR 0009, point 7).
2. **What is asked**: the same request a Start makes, of the same program under the same rules (ADR 0009, point 3; `PageReader.readTitle`, `YtDlp`): the build in use, its environment built from nothing in a temporary folder of its own, its readers of known sites only, no restriction worked around, no cookie, configuration, cache or plugin, one video, the address last after `--`. It is told `--print %(title)j` instead of `--dump-single-json`, and prints one line: the title as JSON, every character past ASCII escaped, so that no code page of the system changes it — seen in a run of the shipped build on a page's description saved as a file, with its requests sent to a closed local port. It is also told `--flat-playlist`: a page that turns out to be a list is one request, not one per video. Nothing of the person's is sent: no cookie, no key, no other link.
3. **Its bounds**: 30 seconds (`TITLE_LIMIT_MS`, against a read's 90) and 64 KiB of output (`MOST_TITLE_BYTES`), then yt-dlp is ended with its whole tree, as a read is. A line for each video is a list, and no title. **The title is one line of text** (`titleOfVideo` in `@scia/core`): its control characters and the marks that turn the direction of a text dropped — a title could show `exe.mp4` and be `mp4.exe` — its white space made one space, cut by whole characters to 200 units (`TITLE_MOST_CHARS`) with an ellipsis. The page shows it as text, never as markup.
4. **No more yt-dlp at once than before**: a title is read only while yt-dlp reads fewer pages — titles and the pages read for downloads together — than the queue starts downloads (`maxConcurrentDownloads`); the others wait, in the order they were copied, and are read as the turns free up. A download never waits for a title: it starts as before, so that a title already being read and the pages of the downloads that start can be, for that moment, one fewer than twice the limit.
5. **A Start never waits for it**: a Start, "Start all" and a Remove stop the title being read — yt-dlp ended with its tree — or forget the one waiting, and an answer that lands all the same is kept nowhere. The download's own read names the file, as before; until the file is named the row shows the title, and once it is named the file's name says it.
6. **Read once, and kept**: the title is in `state.json` beside the row (`title`), as everything of a ready row is (point 7): a restart shows it and asks nothing. A title that could not be read — the site busy, the video unavailable, no answer in time — leaves the row its address, and is not asked again, nor at the next start; nor is a title whose read had not ended when the engine stopped. A state written before titles loads with none, and so does one whose title no row would show.
7. **The contract**: `Download.title`, the title while the file is not named, else `null`; the contract reads its shape, and the engine holds its bounds.
8. **The log** says `ready_title_read` (with whether a title came) and `ready_title_not_read` (with the reason's code), each with the row's id: never the address, never the title.

The alternative this ADR set aside, "asking yt-dlp about every copied page", stays set aside: `VIDEO_SITES` still decides which links are taken, with nothing asked of the network, and yt-dlp is asked only about a link already taken.

Consequences:

- **One request to the site for every video's page copied, and for whatever its reader asks in turn, also for a video the person never starts.** It is the request a Start would make, a few seconds after the copy; `vision.md` says so.
- A title can take up to 30 seconds, and waits while yt-dlp reads as many pages as the queue starts downloads: on a busy site, or behind many copies, a row shows its address for that long.
- An engine with no yt-dlp — under plain Node — reads no title: the row keeps its address. So does a ready row kept from before this amendment.
- A file host's link stays named by its address: AllDebrid's `link/infos` gives a name without unlocking a link (#285), and that is not decided.
- The E2E suite cannot read a title: the built app reads pages only with the shipped yt-dlp, which reads only real sites, and a spec reaches none. Specs hold the read against a stand-in for yt-dlp that answers as the shipped build does (`testing/fake-yt-dlp.mjs`); the E2E suite holds the row, from a state that holds a title; a real site's title is seen in the owner's sitting (#89).
