# ADR 0012 — Links taken from the clipboard: main reads, the engine keeps what it knows

- **Status**: accepted
- **Date**: 2026-11-21

## Context

The roadmap's M1 line "Clipboard watching (optional)" asks that a link the person copies anywhere — a browser, a chat, a document — be offered in Scia's list without pasting it. The owner decided what it does (21 November 2026, #128):

- With a switch in Settings, "Take links from the clipboard", off by default, Scia takes the copied links that are files or videos it knows: a link ending with the extension of a downloadable file; a file host's link (the domains AllDebrid lists); the page of a video on a site yt-dlp reads. Any other web page's address is left out, and so is a link to an image. Several links copied at once are all taken.
- They appear in the list in a new state, "Ready", and do not start: each row has Start and Remove, and "Start all" appears at the top while there are ready rows. A link already in the list is not added twice. Ready rows are kept after a restart.
- When Scia is hidden or not in front, a notification of the system says how many were added.
- A video's page is recognised by a list of sites kept in Scia, with nothing asked of the network when a link is copied.

The clipboard is a new kind of input: until now Scia read only what the person pasted into it, what the extension sent, and what a host answered.

## Decision

1. **Main reads the clipboard, and only main** — the page never does (`apps/desktop/src/engine/clipboard-watch.ts`). Electron has no event for a change of the clipboard: main reads its text **every second, and only while the switch is on**. In Electron 44 the read answers a promise; a read the system refuses is passed over until the next beat. No permission is added to the page: `page-permissions.ts` still refuses every one but `clipboard-sanitized-write`.
2. **Main hears the switch in the engine's events.** The setting is `watchClipboard` (off by default, kept in `state.json`); every list the engine sends on `GET /events` carries it beside the downloads, so main turns the reading on or off the moment it changes, whoever changed it, and again after a restart of the engine — with no member added to the bridge and nothing asked on a timer.
3. **What is on the clipboard when the reading starts was copied for something else, and is not taken** — when the switch is turned on, and when Scia starts with it on. Each text copied afterwards is read once.
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
- A video on a site not in `VIDEO_SITES` is not taken from the clipboard; pasted, it is read as before. The list is kept by hand, and a site that changes the shape of its addresses is missed until it is changed.
- A process started under a job that limits the desktop cannot open the clipboard: every read is refused, and nothing is taken. A sandboxed shell on the owner's machine runs so: the E2E spec answers Electron's read in main, as it answers the folder dialog, and the real clipboard is tried by a person.
- Linux has a second clipboard, the selection: Scia reads the clipboard only, and Linux is untried.
