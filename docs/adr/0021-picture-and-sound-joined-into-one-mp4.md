# ADR 0021 — A page's picture and sound, offered apart, are joined into one mp4 inside Scia

- **Status**: accepted; what follows a join Scia refuses amended below, "Amendment — a join refused falls back to one file or a stream" (#241)
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
   - no other file may take a name a download keeps beside its own while it runs: its part file, a stream's pieces, a pair's picture and sound. A name is taken when one of those is on disk or belongs to a download in the list, and when it is itself one of a download in the list.
4. **They are joined into one mp4 in the part file, nothing re-encoded.**
   - `joinPlan` in `@scia/core` reads the two files' boxes (ISO/IEC 14496-12) and plans what is written: bytes it makes, and ranges of either file copied as they stand. The engine (`joinIntoMp4`) reads only the movies and the fragments' headers, and copies the media.
   - The joined movie has the picture's header and timescale. The picture is track 1 and the sound track 2, with its durations and its edit list moved into that timescale.
   - **Two fragmented files** (what DASH sites give: a `moov` with an `mvex`, then `moof`/`mdat` fragments): the fragments of both are put in the order they play (`tfdt`, or where the one before ended) and numbered again. Each fragment's header names its new track, and a base data offset is moved to the fragment's new place. What follows a fragment's header up to the end of its data is copied as it stands. `sidx`, `mfra` and the rest outside a fragment are left out, since they name places in the files they came from.
   - **Two files that are not fragmented**: the media of both goes into one `mdat`, the picture's then the sound's, and each chunk offset is moved to where its bytes landed. Past 4 GiB the offsets are written on 64 bits (`co64`) and the `mdat` has a 64-bit size.
   - Some files are not joined, and fail with `PAGE_FORMAT_UNSUPPORTED`: one fragmented file beside one that is not; a fragmented file that keeps samples in its movie, or media data outside its fragments (ffmpeg writes it without `empty_moov`, and the plan copies fragments only); a file with more than one track; a picture that is not a picture, or a sound that is not sound. A file whose boxes do not hold together, or a box too short for its fields, fails with `PAGE_UNREADABLE`.
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

## Amendment — a join refused falls back to one file or a stream (2026-11-23, #241)

A join Scia refuses (point 4: a fragmented file beside one that is not, a fragmented file with samples in its movie, more than one track, boxes that do not hold together) failed the download with `PAGE_FORMAT_UNSUPPORTED` or `PAGE_UNREADABLE`. Retry read the page again, chose the same pair, fetched it again and failed again, where before #99 the same page gave its best one file or its stream. #241, opened after the product manager's review of #240, asks that the next reading choose among one files and streams only, that a restart remember it, and that the row say the best quality could not be joined — "version" in the row, not "quality" (the amendment's point 4). Each point below is the team's design of what the issue asks.

1. **A refusal of the join is a failure of its own**, `PAGE_NOT_JOINED`: whatever `joinIntoMp4` refuses in what the two files hold — `PAGE_FORMAT_UNSUPPORTED` and `PAGE_UNREADABLE` alike, since fetched again they would hold the same. A disk that fails during the join, a stop, and a failure on the way to either file are not refusals: the pair is chosen again at the retry, from the bytes kept.
2. **The download keeps a mark of it**, `joinRefused` in `state.json` (`false` by default: a state written before loads with none). Every reading of its page after it chooses among one files and streams only (`chooseMedia(…, { joins: false })`): at the retry, after a restart, and after any later failure. A pair kept in its `source` from before the refusal — a pause or a stop that landed during it leaves one, which a resume would use again — is never fetched again: the page is read instead. The file or stream it gives is kept over a pause as any page's is. The mark is the download's, never the site's: another download of the same page tries its pair.
3. **What the pair fetched is removed at the refusal**: its picture and its sound, with the row's progress — its segments, its bytes and its size — so that no byte of the pair is taken for the next file's. The mark comes first: a file that will not go fails the download with `DISK`, and the retry removes it, as a new reading that makes the download something else always did, and falls back all the same. A refusal of the join's plan — a box longer than its file, a sound cut short, a layout it does not join — comes before the part file is opened, so nothing of the join is left either. The part file goes too, after the picture and the sound: a reading before the pair may have given a one file that failed on its way and left it, and with the name let go (below) it would stay beside the next file, or in its name's way (#305, its review's round 2).
   - **Once they are gone, the name is no longer final.** A download whose name is final keeps the container that name carries, because its part file holds bytes of it (ADR 0009, point 6); a refused download holds none. The next reading takes the best one file or stream of any container, and the download is named after it — `<title>.webm` where it was `<title>.mp4` — as a download is at its first reading. A file that will not go keeps the name, and with it the mp4: that download falls back to an mp4 one file or a stream only, whose run removes the picture and the sound, and writes over the part file, and a page whose one files are all of another container fails its retry with `PAGE_FORMAT_UNSUPPORTED`, the file going with the download's Remove.
4. **The row says it** (`status-line.ts`): "Scia could not join the picture and sound of the best version of this video. Try again: Scia looks for another version on the page." "Version", not "quality", in both sentences: best by Scia's rank, which puts an mp4 above more lines in another container (ADR 0009, point 4), so what Retry takes can have more lines than the pair it replaces. The sentence holds for every cause the code covers, and whether or not the page offers another version: a page that offers nothing but the pair refused fails its retry with `PAGE_FORMAT_UNSUPPORTED`, as a page with no format Scia fetches does.

The consequence "Above that … it takes the best mp4 pair, or the best one file" now reads also below it: a pair Scia does not join gives the best one file or stream at the retry, in whatever container, never the same pair again.
