# ADR 0009 — The video of a page is found by yt-dlp and downloaded by the engine

- **Status**: accepted; its plan for pieces 2 and 3 — a shipped ffmpeg — superseded by [ADR 0010](./0010-a-stream-made-into-an-mp4-inside-scia.md) and [ADR 0021](./0021-picture-and-sound-joined-into-one-mp4.md)
- **Date**: 2026-11-20

## Context

A link pasted from a site of videos is a page. Until now the engine fetched the page itself and saved its HTML as the file. What the person wanted was the video it plays (#89). Every download manager people compare Scia with reads such a page for its video, at the best quality the site offers.

What a page plays is different for every site, and changes when the site does. yt-dlp is the program that knows it: a reader of its own for each of over a thousand sites, maintained by its project and released every few weeks. It is a program, not a library. Its project publishes a build for each system with the checksums of every file (`SHA2-256SUMS`, signed).

The owner decided, on 20 November 2026, on #89:

- only sites yt-dlp has a reader of its own for, never a guess at an unknown page;
- Scia's own engine downloads, streams included, made into an mp4 as other download managers do;
- ffmpeg is shipped too, for the best quality;
- the yt-dlp that is shipped is brought up to date by Scia at most once a day, against the checksums its project publishes.

The work comes in four pieces, each its own PR:

1. a page whose video is one file, with yt-dlp shipped (this ADR);
2. a video offered only as a stream (HLS), downloaded by the engine and made into an mp4 by ffmpeg;
3. video and sound offered apart, joined by ffmpeg;
4. yt-dlp's daily update.

## Decision

1. **A step after the host answers.** When the host of a link answers a web page (`text/html`, `application/xhtml+xml`), the engine asks a reader of pages for the video it plays, through a port (`PageReader`). `YtDlp` is the adapter of that port. A link that is a file never reaches the reader, and neither does a link a service unlocked (ADR 0005): the service said what it is.
2. **yt-dlp reads; the engine downloads.** yt-dlp is run once per page, to print what it found as JSON (`--dump-single-json`), and downloads nothing. The engine chooses a format and fetches it as any other file: several connections, the speed limit, pause and resume, the part file, the mark of a downloaded file (ADR 0003).
3. **What yt-dlp is always told** follows from "Respect the hosts":
   - it uses only the readers of known sites, never its generic one (`--use-extractors default,-generic`);
   - it never works around a geographic restriction (`--xff never`);
   - it reads no cookie, from a file or from a browser (`--no-cookies`, `--no-cookies-from-browser`);
   - it reads no configuration and keeps no cache of its own on this computer (`--ignore-config`, `--no-cache-dir`);
   - it reads one video, never a whole list (`--no-playlist`);
   - it loads no plugin, from beside it or from the person's folders (`--no-plugin-dirs`).

   It is started with an environment of its own, built from nothing: `SystemRoot`, and a temporary folder of its own inside the system's (which main names), made for that run and removed once the process has closed, however it ended — its build unpacks 30 MB there each time and leaves it behind when it is stopped. Never the engine's environment, which holds the API's token. The address comes last, after `--`, so an address that begins with a dash is not an option.
   - _Amended by #174, 26 November 2026, the team's:_ a run's folder that cannot be removed — a process of yt-dlp's that no tree reached still running from it — no longer changes what became of the read: it is logged and left, and removed at the engine's next start, before any read. Its removal is tried again whole for a second and a half, inside the wait main gives a quit. Each run's folder is still made by `mkdtemp` in the system's temporary folder, named for the profile by a hash of the profile's folder, so that what one engine clears at its start is never another Scia's read, and never a folder or a link another user of the computer made.

3a. **What yt-dlp says, and what follows.** Only its `ERROR:` lines are read; its warnings name formats it passed over, not why it stopped.

- A site it does not know: the page is fetched as it stands, as before.
- **A page of a site it knows that plays no video** — a book, an image, a collection, an audio track — said in its own words (`opening play-av tag not found`, archive.org's; `No video formats found`, its own when a site gives no format), or a page whose every format is sound alone — no picture, as the site says, or a container of sound with no codec of picture named (yt-dlp gives an archive.org audio item as one mp3 with no codec named): **the page is fetched as it stands, as before** (#89, "every other page is fetched as it stands"; decided by the author while the owner was away, written on #89, the owner's to reverse). Only those signals lead there, read from what yt-dlp gave before the containers Scia lists are kept: a video in a container Scia does not list fails with `PAGE_FORMAT_UNSUPPORTED`, a page with no format at all with `PAGE_UNREADABLE`, and an error no rule knows stays a failure — never an HTML page saved where a video was asked for.
- A site that is busy — 5xx, 429, a timeout — `PAGE_SITE_BUSY`, whose sentence says to try again later. A protected video `PAGE_DRM`; one the site will not play here `PAGE_UNAVAILABLE`; a list of several items `PAGE_PLAYLIST`; anything else, a reader that could not start or said nothing Scia understands, `PAGE_UNREADABLE`, with no remedy offered.

4. **The choice** (`chooseMedia`): among the formats that are one file over http(s) with picture and sound and no DRM, an mp4 with the most lines of picture; another container only when the site offers no mp4 that way; between equals, the later one the site lists. An mp4 is what the owner asked for, and what every player opens: in the run of this piece, archive.org offered a 304-line `.ogv` beside a 240-line `.mp4`, and the `.ogv` does not open in the system's player. What a site says is checked where it enters, against the contract: a container is one of the containers of a video Scia knows (`VIDEO_CONTAINERS` in `@scia/core`) — never an audio file, a document or a program — and a height a positive whole number or nothing. A video offered only in forms the engine does not fetch yet — a stream, or picture and sound as two files — fails under one code (`PAGE_FORMAT_UNSUPPORTED`) whose sentence is true of both. A protected video is never downloaded (#8).
   - _Amended by #99, 23 November 2026:_ a picture and its sound offered apart are taken too, joined into one mp4 inside Scia ([ADR 0021](./0021-picture-and-sound-joined-into-one-mp4.md)): an mp4 picture in H.264 or AV1 and an AAC sound, the pair ranked by its picture's lines, one file first at equal lines. A format of sound alone now enters in a container of sound, used only as the sound of a pair. `PAGE_FORMAT_UNSUPPORTED` is left for DASH and for picture and sound apart in forms Scia does not join (#239).
5. **The video is asked for with the headers its site gave** (its user agent, its referrer), and with no other — not the page the link was on. Of a site's headers, what a client chooses for itself or what concerns the connection (`Range`, `Accept-Encoding`, `Host`, `Cookie`, …) is dropped, and `Accept-Encoding: identity` is always sent last.
6. **What was chosen is kept** in `state.json`, as one value read whole or not at all (`video`: its `media`, and the `source` its site gave, address and headers): the video's address is used again after a pause and after a restart, and the page is read again after a failure, because a site's address of a video expires. Read again for a download whose name is final, it keeps the container that name carries, or fails. The download keeps a mark of its own that it is a page's video (`fromPage`), which survives a `video` refused at load — a container a later version no longer takes — so that the page is read again for it, never fetched into its file. The address of the video is never in an answer of the API and never in a log; the row shows its container and lines of picture ("MP4 1080p"), and when the address has stopped working, says that trying again reads the page for a new one.
7. **The file is named after what the site calls the video**, made safe like any name from a host (a slash in a title is a character, not a path), with the container's extension.
8. **yt-dlp is shipped, fixed by version and checksum.** `apps/desktop/scripts/fetch-tools.ts` fixes the version and the sha256 of each system's build. The file is fetched at build time, as electron-builder's `beforePack` hook for the system being packed and by `npm start` for this computer, and refused unless its bytes match. Builds go in the installer under `resources/tools/`. Main gives the engine its path (`SCIA_YT_DLP`). An engine whose yt-dlp is named and missing, or one with none named (plain Node, `npm run dev`), fetches pages as they stand.
9. **Its licence travels with it.** yt-dlp's code is released under the Unlicense; the builds its project publishes bundle Python and other libraries and are distributed under the GNU GPL, version 3 or later. The installer carries the licence's text and where the source is (`resources/third-party/yt-dlp/`). yt-dlp is shipped unchanged, as a separate program Scia runs, so Scia's own licence is not changed by it.

### Against what ADR 0001 said of aria2

[ADR 0001](./0001-electron-and-a-local-engine.md) rejected aria2 as "an external binary to ship, update and supervise per platform", one that would keep its own state and decide how segments are reported. yt-dlp is such a binary, and is taken for a narrower job:

- **it holds no download**: no state of its own, no segment, nothing to report; it says what a page plays, and the engine does the rest;
- **it is shipped** by version and checksum per system (point 8), and **updated** by piece 4;
- **it is supervised per page, not per run**: started for one page, given up on after 90 seconds or when the download is paused or removed, and never kept running. When it fails or is missing, a page is still a page: it is saved as it stands, or its row says why not.

### Against the vision's "the app talks to the servers it downloads from"

`docs/product/vision.md` lists whom the app talks to. yt-dlp adds requests that are not the app's own downloads: to read a page it asks the page's site — the address the person pasted — and whatever that site's reader asks in turn to find the video (its player, its own API, the host of its files), which can be hosts the person never named. It sends nothing of the person's: no cookie, no key, nothing of other links, and no address a restriction would need. The vision's line is amended in the same change to say so.

## Alternatives considered

- **yt-dlp downloads too**: one program for everything, but the download would be outside the engine: no segment bar, no shared speed limit, no pause that keeps the bytes, a second way of writing files. Not chosen by the owner.
- **Readers of sites written in Scia**: every site, by hand, forever behind the sites themselves.
- **yt-dlp's generic reader for every page**: it guesses a video in any page, including pages the person never meant as one. Not chosen by the owner.
- **yt-dlp fetched on first use instead of shipped**: a smaller installer, but a first video that waits on a download of 22 MB, and an installer that does not work offline.

## Consequences

- The installer grows by yt-dlp's build: 22.5 MB on Windows.
- Reading a page starts a process, and that is the wait before the first byte. Timed on the owner's Windows computer on 20 November 2026, against archive.org: from adding the link in the real app to the first byte of the video, 6.3 and 7.2 s (two runs of this piece), of which the shipped yt-dlp alone, run with the engine's options, took 2.2 to 4.8 s on video pages and about 2.5 s on pages where it stops at once (the reviewers' runs). More on a slow site; the row says "Connecting…" meanwhile.
- yt-dlp sends its own requests to the site of the page, and to what that site's reader asks, with its own user agent. The README and the vision say so.
- A site that changes faster than the shipped yt-dlp breaks until the next release of Scia, until piece 4 lands.
- A video offered only as a stream, or with picture and sound apart, fails until pieces 2 and 3 land, with a sentence that says Scia cannot download it yet. Many large sites of videos offer their best quality as picture and sound apart, beside a lower one as one file: until piece 3, Scia takes the one file, and the row says its lines of picture.
- Linux has a build fixed and fetched (`yt-dlp_linux`); like everything on Linux, it is untried (#13).
