# Scia — integrations

Every site, service and program Scia reaches beyond the host of a link it was given, and what each one adds. One row per integration. **A PR that adds one, or changes what one does, changes its row here, and the line of [vision.md](./vision.md) ("It collects nothing") that says whom Scia talks to and what it sends.** That line is where what each host is sent is written; this file does not repeat it. What was seen of each, and how: [evidence.md](./evidence.md). The order of the work: [roadmap.md](./roadmap.md).

Every integration keeps to "Respect the hosts", the principle as the root [`CLAUDE.md`](../../CLAUDE.md) states it, whole: what it lets Scia fetch, a debrid service among it, and what it forbids.

## Services the person connects

A service is connected once, in Settings: with a code confirmed on the service's own site, or with the key of the account. Its key is kept where the system protects it ([ADR 0004](../adr/0004-the-key-of-a-service.md), [ADR 0023](../adr/0023-a-key-said-kept-once-it-can-be-read-back.md)).

### AllDebrid

What it adds:

- A file host's link unlocked into a direct link, and downloaded like one.
- That link unlocked again when it expires on the way.
- A file host's folder, or a protector's or a shortener's link, opened into its files through AllDebrid's redirector: a row with every file ticked, and the files left ticked downloaded into a folder named after the link (#181).
- A pasted magnet fetched by the service, its files downloaded in their folders — a magnet of one file straight into the download folder (#150). The field names magnets while the service is connected.
- The account's magnets listed beside the list.
- A magnet copied to the clipboard sent at once.
- With no service connected, its public list of file hosts says which links need one.

ADRs: [0005](../adr/0005-a-service-resolves-a-link.md), [0006](../adr/0006-a-file-host-without-a-service.md), [0013](../adr/0013-a-key-that-arrives-by-a-code.md), [0014](../adr/0014-magnets-through-a-service.md), [0016](../adr/0016-the-magnets-of-the-account.md), [0017](../adr/0017-a-magnet-taken-from-the-clipboard.md), [0022](../adr/0022-a-direct-link-that-expires.md), [0025](../adr/0025-a-link-that-opens-into-several-files.md).

**State:** written and held by specs. #7 is open: the follow-up #146 is open — but for its point `v1.0.0` waited for, a code confirmed after Settings closed (#286) — and so is #150 for its other points; the owner's try with a real key is to come. How each piece was seen, by piece ([evidence.md](./evidence.md), M3):

| Seen in the real app, against a simulated service                                                                                                                                        | Held by specs or CI's E2E only, never seen in the app                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The connection by a key (#47) and by a code (#136); the unlocking of a pasted link (#48); a file host without a service (#49); a pasted magnet (#137); the magnets of the account (#138) | A magnet from the clipboard (#139, CI's E2E); a link that expires on the way (#180, specs); a key read back after a kill (#69, CI's E2E); a link that opens into several files (#181, specs and CI's E2E); a code confirmed after Settings closed, and its notifications (#286, specs and CI's E2E) |

**The real service:** tried once with a real account, on 20 November 2026. A link was recognised and unlocked, and downloaded at up to 141 MB/s, but none of three runs finished: the direct link answered parts of the file with 204. Scia was mended for what it met. A download through the real service, to its end, is still to be seen (#7). So is how the real service answers a file host's folder: its documentation says the redirector opens the links of "a redirector or link protector", and lists 1fichier, mega and the like among them, but never says it opens a folder ([ADR 0025](../adr/0025-a-link-that-opens-into-several-files.md)).

## Readers of pages

A link whose host answers a web page is read for what it plays or lists. The reader runs on this computer, and the engine downloads what it found, as any file. A reader's own requests can reach hosts the person never named: yt-dlp asks the page's site, and whatever that site's reader asks in turn to find the video ([ADR 0009](../adr/0009-the-video-of-a-page.md), "Against the vision").

### yt-dlp (shipped)

What it adds: the video a page plays, on the sites yt-dlp has a reader of its own for (never its generic one). Scia takes the best it can fetch:

- one file;
- an HLS stream, made into an mp4;
- a picture and its sound offered apart, joined into one mp4 — and, when Scia refuses to join the two files it fetched, the best one file or stream at the retry (#241).

And the title of a video's page taken from the clipboard, read the moment it is taken, for that title alone, so that its "Ready" row names the video instead of its address: the same request a Start would make, before any Start and also for a video the person never starts ([ADR 0012](../adr/0012-links-taken-from-the-clipboard.md), amended by #285).

No ffmpeg. yt-dlp is kept up to date by Scia from its signed releases.

ADRs: [0009](../adr/0009-the-video-of-a-page.md), [0010](../adr/0010-a-stream-made-into-an-mp4-inside-scia.md), [0011](../adr/0011-yt-dlp-kept-up-to-date.md), [0021](../adr/0021-picture-and-sound-joined-into-one-mp4.md), [0012](../adr/0012-links-taken-from-the-clipboard.md). Issues: #89, #97, #98, #99, #100, #241, #285.

**State:**

- **One file** (#97): seen in the real app with a video of archive.org. Other sites were not tried.
- **Streams** (#98), **picture and sound** (#99) and **a join refused falling back** (#241): held by specs against local hosts. A real site's is the owner's check, on a beta.
- **The update of yt-dlp** (#100): seen in the real app against a local host that publishes a release again under a newer name. A real new release taken from GitHub is not seen.
- **The title of a ready row** (#285): held by specs against a stand-in for yt-dlp, and the row by CI's E2E suite on the built app, from a state that holds a title. How the shipped build prints a title was seen in a run of it on a page's description saved as a file, with nothing asked of the network. A real site's title is not seen.

### Bunkr's albums (Scia's own)

What it adds: every file of a public album, into a folder named after the album, each file a download of its own — resumable, under the speed limit. A file's page pasted by itself is downloaded the same way. Its domains are kept as data in one list. No second program is shipped, and no service is asked about a Bunkr link.

ADR: [0024](../adr/0024-a-bunkr-album-read-by-scia.md), and its amendment. Issues: #228, #266, #398.

**State:** held by specs, and by CI's E2E suite on the built app, against a local host that answers as Bunkr does. Seen against the real Bunkr once, on a Mac: a public album of 65 files downloaded whole in the built app (#398). Not yet seen in the owner's hands on Windows (#266). The album and file pages are read as gallery-dl's public source reads them. Each file's link is asked as Bunkr's own download page asked it on 27 November 2026: its API, then a signing service for the link, which Bunkr's file servers ask for ([evidence.md](./evidence.md#a-bunkr-album)).

## What Scia asks of GitHub

| What                                                              | Why                                                               | ADRs                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| This repository's releases, read by the installed app             | Scia updates itself                                               | [0007](../adr/0007-automatic-updates.md), [0015](../adr/0015-a-restart-to-install-an-update.md) |
| yt-dlp's releases (`github.com/yt-dlp/yt-dlp`), their signed sums | The shipped yt-dlp is brought up to date, while nothing downloads | [0011](../adr/0011-yt-dlp-kept-up-to-date.md)                                                   |

How often each is asked, and with what: [vision.md](./vision.md), "It collects nothing".
