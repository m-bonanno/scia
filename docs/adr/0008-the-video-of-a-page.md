# ADR 0008 — The video of a page is found by yt-dlp and downloaded by the engine

- **Status**: accepted
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
   - it reads one video, never a whole list (`--no-playlist`).

   The address comes last, after `--`, so an address that begins with a dash is not an option. A site yt-dlp does not know is fetched as it stands, as before.

4. **The choice** (`chooseMedia`): the format with the most lines of picture, among those that are one file over http(s) with picture and sound and no DRM; between equals an mp4, then the later one the site lists. A video that is protected, unavailable or a list fails with a code of its own (`PageFailure`), and the row says why. So does a video offered only in forms the engine does not fetch yet — a stream, or picture and sound as two files — under one code (`PAGE_FORMAT_UNSUPPORTED`) whose sentence is true of both. A protected video is never downloaded (#8).
5. **The video is asked for with the headers its site gave** (its user agent, its referrer), and with no other. `Accept-Encoding: identity` is always sent last, so no header a site gives can change it.
6. **What was chosen is kept** in `state.json` (`media`, `mediaUrl`, `mediaHeaders`): the video's address is used again after a pause and after a restart, and the page is read again after a failure, because a site's address of a video expires. The address of the video is never in an answer of the API and never in a log; the row shows its container and lines of picture (`media`: "MP4 1080p").
7. **The file is named after what the site calls the video**, made safe like any name from a host (a slash in a title is a character, not a path), with the container's extension.
8. **yt-dlp is shipped, fixed by version and checksum.** `apps/desktop/scripts/fetch-tools.mjs` fixes the version and the sha256 of each system's build. The file is fetched at build time, as electron-builder's `beforePack` hook for the system being packed and by `npm start` for this computer, and refused unless its bytes match. Builds go in the installer under `resources/tools/`. Main gives the engine its path (`SCIA_YT_DLP`). An engine whose yt-dlp is named and missing, or one with none named (plain Node, `npm run dev`), fetches pages as they stand.
9. **Its licence travels with it.** yt-dlp's code is released under the Unlicense; the builds its project publishes bundle Python and other libraries and are distributed under the GNU GPL, version 3 or later. The installer carries the licence's text and where the source is (`resources/third-party/yt-dlp/`). yt-dlp is shipped unchanged, as a separate program Scia runs, so Scia's own licence is not changed by it.

### Against what ADR 0001 said of aria2

[ADR 0001](./0001-electron-and-a-local-engine.md) rejected aria2 as "an external binary to ship, update and supervise per platform", one that would keep its own state and decide how segments are reported. yt-dlp is such a binary, and is taken for a narrower job:

- **it holds no download**: no state of its own, no segment, nothing to report; it says what a page plays, and the engine does the rest;
- **it is shipped** by version and checksum per system (point 8), and **updated** by piece 4;
- **it is supervised per page, not per run**: started for one page, given up on after 90 seconds or when the download is paused or removed, and never kept running. When it fails or is missing, a page is still a page: it is saved as it stands, or its row says why not.

## Alternatives considered

- **yt-dlp downloads too**: one program for everything, but the download would be outside the engine: no segment bar, no shared speed limit, no pause that keeps the bytes, a second way of writing files. Not chosen by the owner.
- **Readers of sites written in Scia**: every site, by hand, forever behind the sites themselves.
- **yt-dlp's generic reader for every page**: it guesses a video in any page, including pages the person never meant as one. Not chosen by the owner.
- **yt-dlp fetched on first use instead of shipped**: a smaller installer, but a first video that waits on a download of 22 MB, and an installer that does not work offline.

## Consequences

- The installer grows by yt-dlp's build: 22.5 MB on Windows.
- Reading a page starts a process: about two seconds on this computer before the first byte, more on a slow site.
- yt-dlp sends its own requests to the site of the page, with its own user agent. The README says so.
- A site that changes faster than the shipped yt-dlp breaks until the next release of Scia, until piece 4 lands.
- A video offered only as a stream, or with picture and sound apart, fails until pieces 2 and 3 land, with a sentence that says Scia cannot download it yet. Many large sites of videos offer their best quality as picture and sound apart, beside a lower one as one file: until piece 3, Scia takes the one file, and the row says its lines of picture.
- Linux has a build fixed and fetched (`yt-dlp_linux`); like everything on Linux, it is untried (#13).
