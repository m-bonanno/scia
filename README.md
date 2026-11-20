# Scia

A download manager for Windows, with Linux to follow: paste a link, Scia fetches it over several connections, resumes it if it breaks, and asks nothing else of you.

![Scia with a few downloads in progress](docs/design/downloads-in-progress.png)

**There is no stable release yet.** The pre-releases (`v1.0.0-beta.N`) on the Releases page carry their notes and, from `v1.0.0-beta.10` on, a Windows installer (`Scia-Setup-<version>.exe`); from `v1.0.0-beta.13` on, every pre-release also carries the files the updater reads (`latest.yml`, the blockmap). The installer is not signed, so Windows warns before running it. To try Scia, install a pre-release, or build it from the source (below).

## What it does today

- Downloads any http/https link over several connections in parallel, handing work over when one finishes before the others.
- Pauses and resumes from the bytes it already has, even after the app was closed and opened again.
- Keeps downloading from the system tray when the window is closed with downloads running or waiting; closing it with nothing left quits (Windows, verified by script: the icon, its menu, its tooltip and its click not yet seen or pressed by a person, #13; Linux not yet tried).
- Wears its own icon, drawn from its mark: the installer, the installed program, its uninstaller and its shortcuts carry it, as read from the system (Windows, #81). How Windows draws it on screen — the taskbar, the tray, the Start menu — has not been seen, and on the owner's machine the taskbar names Scia "Electron" (#85).
- Says when a download ends — completed or failed — with a notification of the system, while its window is not the one in use (Windows; asked of the system under a script, not yet seen or clicked; a Scia that opened behind the window in use can be silent until it has been used once, minimised, or closed into the tray; Linux not yet tried).
- Marks what it downloads as coming from the network, as a browser does, so that Windows can ask before running it (Windows; seen with a script, not yet with an `.exe`, an installer or a document); and asks for a second press itself before running a downloaded program.
- Keeps a queue: how many downloads at once and how many connections per download are settings, and so are the folder they go to and a speed limit for all of them together.
- Wears one of nine colour themes, chosen in Settings, each in a light and a dark variant that follows the system (seen on a dark system; the light variant with the page told to be light, not yet on a light one); the default one is black and white.
- Updates itself on Windows from the releases of this repository: the stable ones, and the betas too when "Beta versions" is on in Settings (off by default). It downloads an update only while it downloads nothing else, and installs it when you quit it — from the tray, or closing the window with nothing left to download — and stays closed; never when Windows ends it ([ADR 0007](./docs/adr/0007-automatic-updates.md)). It asks GitHub for the releases once it starts and every six hours — an hour after a check that failed — with nothing of yours. Seen against this repository's releases, from a build of its branch to `v1.0.0-beta.13`; no stable release exists yet to update to. It begins with the first beta after #82: a Scia installed before it is updated by hand once.
- Downloads the video a page plays, instead of the page, when the page is on a site [yt-dlp](https://github.com/yt-dlp/yt-dlp) knows and the site offers the video as one file: an mp4 at the most lines of picture it offers that way, named after the video (Windows; seen in the real app with a video of archive.org; other sites not tried). yt-dlp is shipped with Scia and reads the page itself, with its own requests to that site and to what its reader asks, with nothing of yours. A page of such a site that plays no video — a book, an image, an audio track — is saved as it stands, as any page; a protected video, one the site will not play here, a list, a busy site, a live stream, a stream that changes partway (stitched ads or intros), and a video offered only as DASH or as picture and sound apart are not downloaded, and the row says why. A video offered as an HLS stream is downloaded too, piece by piece, and made into one mp4 inside Scia, with no other program: the row says how far it is by its pieces (specs against local streams; not yet seen on a site, #98, [ADR 0010](./docs/adr/0010-a-stream-made-into-an-mp4-inside-scia.md)) ([ADR 0009](./docs/adr/0009-the-video-of-a-page.md), #89).
- Takes links and media from the browser through the extension (`apps/extension`) — written and tested in its logic, not yet tried in a real browser.

What comes next: [`docs/product/roadmap.md`](docs/product/roadmap.md).

## Integrations

Scia connects to outside services one at a time, each listed here when it lands. A service is connected once, in Settings, with the key of your account, which Scia keeps where the operating system protects it.

With no service connected, Scia asks AllDebrid for the public list of the file hosts it supports — with no key and nothing of your links: once a run first needs it, then every six hours while it runs, and an hour after a reading that failed — one request each time, given up on after three seconds — so that a file host's link says it needs a service instead of saving the host's page as the file ([ADR 0006](./docs/adr/0006-a-file-host-without-a-service.md)).

| Service   | What it adds                                               | State                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AllDebrid | Hoster links are unlocked and downloaded like direct links | Connected once in Settings; a pasted hoster link is unlocked through it and downloaded, and its row says "via AllDebrid" — tried against a simulated service, and in three runs with a real account, where AllDebrid's direct link answered parts of a file with 204 and once its first byte with a one-byte 200: Scia now copes with both, not yet tried for real (#7) |

## Development

Node 24 or later.

```bash
npm ci
npm run dev     # engine + interface on http://localhost:5173
npm start       # the real Electron app, on a scratch profile
npm test
```

How the project is built and how to work on it: [`CLAUDE.md`](CLAUDE.md). The architecture decisions: [`docs/adr/`](docs/adr/).

### Contributing

An issue first, then a pull request that closes it: [`CONTRIBUTING.md`](CONTRIBUTING.md). Work happens on a `<type>/<issue>-<description>` branch cut from `develop`, with conventional commits, and lands through a PR into `develop`: [`docs/development/git-flow.md`](docs/development/git-flow.md). Versions are decided by semantic-release from the commits: [`docs/development/release-flow.md`](docs/development/release-flow.md).

## Licence

[MIT](LICENSE). The installer also carries yt-dlp's own build, unchanged, under its licence: [`apps/desktop/third-party/yt-dlp`](apps/desktop/third-party/yt-dlp/README.txt); and the engine bundles mux.js, under the Apache License 2.0: [`apps/desktop/third-party/mux.js`](apps/desktop/third-party/mux.js/README.txt).
