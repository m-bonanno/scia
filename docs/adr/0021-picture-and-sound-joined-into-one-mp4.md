# ADR 0021 — A page's picture and sound, offered apart, are joined into one mp4 inside Scia

- **Status**: accepted
- **Date**: 2026-11-23

## Context

Many sites of videos offer their best quality as two files: the picture alone and the sound alone, which their player plays together. They offer one file with both only in a lower quality (on YouTube, 360 lines). Until now Scia took the best one file ([ADR 0009](./0009-the-video-of-a-page.md), point 4), and failed with `PAGE_FORMAT_UNSUPPORTED` on a page that offered nothing else.

#89 planned a shipped ffmpeg to join them. [ADR 0010](./0010-a-stream-made-into-an-mp4-inside-scia.md) replaced ffmpeg for streams with code inside Scia, on the owner's decision (20 November 2026, #98). The same reasons hold for a picture and its sound. ffmpeg weighs 128 MB on disk and about 53 MB in the installer, and joining needs no re-encoding, so the quality is the same whichever tool does it.

The owner decided that `v1.0.0` waits for this piece (21 November 2026, on #99). How the two are joined was the issue's open question. On 23 November 2026, as two multiple-choice questions, the owner decided:

- **the picture codecs taken are H.264 and AV1.** The most lines win, and H.264 at equal lines, since every player opens it. HEVC is never taken: Windows plays it only with a paid extension;
- **only an mp4 picture with an m4a sound** in this issue. A site whose best quality is only in webm (VP9, Opus) gives its best mp4 pair, or its best one file. A webm or mkv writer is an issue of its own (#239).

## Decision

1. **A pair is a format like a file** (`chooseMedia`). Its picture is a format with no sound and its sound a format with no picture. Both are one file over http(s) and not protected.
   - The picture is in an mp4 and its codec is H.264 (`avc1`, `avc3`, `h264`) or AV1 (`av01`).
   - The sound is AAC (`mp4a`) in an m4a or an mp4.
   - The best picture has the most lines, and is H.264 at equal lines. The best sound is in the video's own language (yt-dlp's `language_preference`), then has the highest bitrate (`abr`, or `tbr`).
   - A pair stands with the picture's lines in the ranking of ADR 0009 and 0010. At equal lines, one file comes first because it is fetched as it stands, then the pair, then a stream.
   - A download whose name is final keeps its container: only an mp4 is joined.
2. **yt-dlp's formats of sound alone are read** in a container of sound (`AUDIO_CONTAINERS`), with their bitrate and the preference of their language. They are used only as the sound of a pair. A page whose every format is sound alone is still fetched as it stands (ADR 0009, 3a).
3. **The two files are fetched as files are** (`PairTask`):
   - each is a `DownloadTask` with several connections, the one speed limit and the retries, the picture first;
   - they land in files beside the part file, `<name>.scia.picture` and `<name>.scia.sound`;
   - the row shows them on one line of segments, the picture's bytes and then the sound's. That line is what `state.json` keeps, so a pause or a restart goes on from what both hold;
   - the sound's address and headers are kept in the record's `source` beside the picture's: never in an answer or a log.
4. **They are joined into one mp4 in the part file, nothing re-encoded.**
   - `joinPlan` in `@scia/core` reads the two files' boxes (ISO/IEC 14496-12) and plans what is written: bytes it makes, and ranges of either file copied as they stand. The engine (`joinIntoMp4`) reads only the movies and the fragments' headers, and copies the media.
   - The joined movie has the picture's header and timescale. The picture is track 1 and the sound track 2, with its durations and its edit list moved into that timescale.
   - **Two fragmented files** (what DASH sites give: a `moov` with an `mvex`, then `moof`/`mdat` fragments): the fragments of both are put in the order they play (`tfdt`, or where the one before ended) and numbered again. Each fragment's header names its new track, and a base data offset is moved to the fragment's new place. What follows a fragment's header up to the end of its data is copied as it stands. `sidx`, `mfra` and the rest outside a fragment are left out, since they name places in the files they came from.
   - **Two files that are not fragmented**: the media of both goes into one `mdat`, the picture's then the sound's, and each chunk offset is moved to where its bytes landed. Past 4 GiB the offsets are written on 64 bits (`co64`) and the `mdat` has a 64-bit size.
   - One fragmented file beside one that is not, a file with more than one track, a picture that is not a picture or a sound that is not sound: `PAGE_FORMAT_UNSUPPORTED`. A file whose boxes do not hold together: `PAGE_UNREADABLE`.
   - The part file is synced and the two files removed. Then the part file is marked and renamed as any download is (ADR 0003). The size is the mp4's own, read from the file.
5. **A stored pair is read whole or not at all.** A `source` of kind `pair` without its sound is refused at load, and the page is read again (`fromPage`). A state written before pairs loads with no sound.

## Alternatives considered

- **A shipped ffmpeg** (#89's plan): any codec in any container, but 128 MB on disk, and refused for streams by the owner for that weight (ADR 0010).
- **mp4box.js, or another library**: a dependency to bundle, licence and keep up to date, for the few hundred lines that rewrite a movie's boxes and copy the rest. ADR 0010 took mux.js because transmuxing MPEG-TS is a real job; moving boxes is not.
- **The fragments of one track, then the other's**: simpler, but a player that reads a file in order would have the sound only after the whole picture.
- **Asking yt-dlp to merge** (`-f bv+ba` with its own merger): it merges with ffmpeg, which Scia does not ship, and the download would be outside the engine (ADR 0009, "Alternatives").

## Consequences

- Scia downloads the best quality of the many sites that offer it apart, in H.264 or AV1 and AAC, as one mp4. Above that — a VP9 webm with Opus — it takes the best mp4 pair, or the best one file (#239).
- A pair takes as much room again while it is joined: the mp4 is written beside the two files, and they are removed after.
- No new program and no new library is shipped.
- What was checked: the specs, on files made by ffmpeg for them (`apps/server/src/testing/pair/`, by `generate.mjs`, by hand). By hand, ffprobe and ffmpeg read the joined files of both layouts (plain and fragmented, the latter with a `sidx` before each fragment). They decoded every frame (30 of picture, 66 of sound), and every packet's checksum was the same as in the file it came from. Neither tool is shipped or used by a spec.
- No site's pair has been seen in the real app. That check is the owner's, on the beta after the merge, as for streams.
