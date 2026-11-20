# ADR 0010 — A page's video offered as an HLS stream is made into an mp4 inside Scia

- **Status**: accepted
- **Date**: 2026-11-20

## Context

[ADR 0009](./0009-the-video-of-a-page.md) downloads the video a page plays when the site offers it as one file. Many sites offer their videos only as an HLS stream instead, or offer a stream in better quality than any file: a playlist that lists the pieces of the video (an `.m3u8` file), each a few seconds long, fetched one by one. Piece 2 of #89 (#98) downloads those as well, and the person gets one mp4.

#89 had decided that a shipped ffmpeg would join the pieces. Before anything was built, the owner looked at what that weighs (20 November 2026, on #98). `ffmpeg.exe` in BtbN's LGPL build is 128 MB on disk, and about 53 MB more in the installer. Making the mp4 needs no re-encoding: the pieces are put back together as they are, so the quality is the same whichever tool does it.

The owner decided, the same day:

- **no ffmpeg**: the mp4 is made inside Scia, in JavaScript;
- **AES-128 is downloaded when its key is public**: Scia does what the page's player does for anyone. DRM stays excluded;
- **live streams are recorded until the person stops them**, in a piece of their own (#121).

## Decision

1. **A stream is a format like a file.** `chooseMedia` takes a format with `m3u8`/`m3u8_native` as its protocol, picture and sound, and no DRM.
   - Its container is `mp4`, the one Scia makes.
   - Between an mp4 file and a stream, the most lines of picture win. At equal lines the file wins, because it is fetched as it stands.
   - DASH (`http_dash_segments`) is not taken, and neither are picture and sound offered apart (#99).
2. **The engine reads the playlist** (`parsePlaylist` in `@scia/core`, RFC 8216): the pieces, how long each lasts, their number, their key, their init segment and their byte ranges.
   - The address yt-dlp gives is the playlist of one quality. A playlist of qualities instead is `PAGE_UNREADABLE`.
   - A playlist with no end (`#EXT-X-ENDLIST`) is live: `PAGE_LIVE` until #121.
3. **The pieces are fetched as files are** (`HlsTask`):
   - over the connections the settings allow, each read booked against the one speed limit (`Throttle`), a failure that heals asked again;
   - written one file per piece into a folder beside the part file (`<name>.scia.pieces`), each written under another name and renamed once whole;
   - after a pause or a restart, what is in the folder is not asked for again;
   - a label in the folder says which quality the pieces are of. Pieces of another quality, found after the page was read again, are thrown away.
4. **AES-128 with a key the playlist names is opened.**
   - The key is fetched from that address, with the headers the site gave and no cookie, once per key. The IV is the key's own, or the piece's number.
   - `SAMPLE-AES`, and a `KEYFORMAT` other than `identity`, are DRM: `PAGE_DRM`, as a session key that names them is.
5. **The mp4 is made in the part file, nothing re-encoded.**
   - Fragmented mp4 pieces are put behind their init segment as they are.
   - MPEG-TS pieces are transmuxed by mux.js (Apache 2.0, bundled in the engine), one piece at a time. The init segment is written once, the timestamps start at zero, and each piece gives a fragment of picture and one of sound.
   - The folder of pieces is then removed, and the part file is marked and renamed as any download is (ADR 0003).
6. **The row says how far it is by the pieces.** A stream's size is not known before, but its length is.
   - The contract carries a `timeline` (milliseconds, each piece a segment of it). It is kept in `state.json` for the row of a stream that is not running.
   - The bar draws the pieces on that line: the segment bar stays Scia's signature.
   - The percentage is the time fetched. The time left assumes that the rest weighs as much per second of video as what was fetched.
7. **A stream fails as a file does.**
   - A host that refuses a piece gives `HTTP_STATUS`, and the row says the address the site gave stopped working: trying again reads the page for a new one (ADR 0009, point 6).
   - The stream's own refusals are page failures with their own sentences.

## Alternatives considered

- **A shipped ffmpeg** (#89's first decision): robust on any format, but 128 MB more on disk, about 53 MB more in the installer, and a third program to fix, update and supervise. Not chosen by the owner, once its size was seen.
- **Keeping the `.ts`**: concatenated MPEG-TS pieces play in many players without any muxing, but the owner asked for an mp4, and not every player opens a `.ts`.
- **yt-dlp downloads the stream**: the download would be outside the engine (ADR 0009, "Alternatives").

## Consequences

- No new program is shipped. The engine grows by mux.js's code, bundled. Its licence travels in the installer (`resources/third-party/mux.js/`).
- The pieces of a stream take as much room again while it downloads: the mp4 is written beside them, and they are removed after.
- A stream's percentage counts time, not bytes. Pieces of unequal weight make the time left an estimate.
- What mux.js does not transmux fails as unreadable. Its output was checked with ffprobe and decoded by ffmpeg, on this repository's fixtures, by hand: 30 frames of picture, all the sound, timestamps from zero. Neither tool is shipped or used by a spec. The fixtures under `apps/server/src/testing/hls/` were made with ffmpeg by `generate.mjs`.
- No site's stream has been seen in the real app. That check is the owner's, before the merge or on the beta (the owner, 20 November 2026).
