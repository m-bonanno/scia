<p align="center">
  <img src="apps/desktop/assets/icon.svg" width="88" height="88" alt="">
</p>

<h1 align="center">Scia</h1>

<p align="center">
  <b>A download manager for Windows.</b><br>
  Paste a link, and Scia fetches it over several connections, resumes it if it breaks, and asks nothing else of you.
</p>

<p align="center">
  <a href="https://github.com/m-bonanno/scia/releases"><b>Download</b></a> ·
  <a href="docs/product/roadmap.md">Roadmap</a> ·
  <a href="https://github.com/m-bonanno/scia/issues/new?template=bug.yml">Report a bug</a> ·
  <a href="#support">Support</a>
</p>

<p align="center">
  <a href="https://github.com/m-bonanno/scia/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/m-bonanno/scia?include_prereleases&sort=semver&label=release"></a>
  <a href="https://github.com/m-bonanno/scia/actions/workflows/release.yml"><img alt="The release pipeline on develop" src="https://img.shields.io/github/actions/workflow/status/m-bonanno/scia/release.yml?branch=develop&label=release%20pipeline"></a>
  <a href="LICENSE"><img alt="Licence: MIT" src="https://img.shields.io/github/license/m-bonanno/scia?label=licence"></a>
  <a href="https://github.com/sponsors/m-bonanno"><img alt="Sponsor on GitHub" src="https://img.shields.io/badge/sponsor-on%20GitHub-ea4aaa?logo=githubsponsors"></a>
</p>

<p align="center">
  <img alt="Scia at work: three links pasted at once, each file arriving over several connections until all three are done" src="docs/design/scia-at-work.gif#gh-dark-mode-only">
  <img alt="Scia at work: three links pasted at once, each file arriving over several connections until all three are done" src="docs/design/scia-at-work-light.gif#gh-light-mode-only">
</p>

## What it does

### Downloads that hold

- ⚡ **Several connections at once** for any http or https link.
- ⏯️ **Pause and resume**, also after Scia was closed and opened again.
- 🚦 **A queue**: how many downloads at once, how many connections each, and one speed limit for all.

### Videos, services and albums

- 🎬 **The video a page plays**, read by yt-dlp: one file, an HLS stream, or a picture and its sound joined into one mp4.
- 🔗 **AllDebrid**, connected with a code or a key: file hosts' links and folders, magnets, and the magnets of your account.
- 🖼️ **Bunkr albums**, every file into a folder named after the album.
- 📋 **Links to files and videos you copy**, once "Take links from the clipboard" is on in Settings, wait in the list as "Ready": a video's page under its title.

### Home on Windows

- 🖥️ **The system tray**: close the window, and the downloads go on.
- 🔔 **Notifications** when a download completes or fails while you are in another window.
- 🎨 **Nine colour themes**, each light and dark, following the system.
- 🛡️ **Downloads marked as from the network**, and a second press to run a program.
- 🔄 **Updates itself** from this repository's releases, without stopping a download.

> [!NOTE]
> All of it is built and held by tests, and much of it is still to be seen by a person before the first stable release. That holds for the installed app, and for the real services and sites Scia reaches: a download through AllDebrid to its end, the real Bunkr, and a video read from a real site, whether a stream, a picture and its sound joined, or its title alone. None of it has been tried on Linux, and the browser extension that hands Scia links is neither tried in a browser nor published. What was seen of each feature, and how: [`docs/product/evidence.md`](docs/product/evidence.md). What is left and what comes next: [`docs/product/roadmap.md`](docs/product/roadmap.md).

## Get it

**There is no stable release yet.** Scia is in pre-release: the latest `v1.0.0-beta.N` on the [Releases page](https://github.com/m-bonanno/scia/releases) carries its notes and a Windows installer, `Scia-Setup-<version>.exe`.

> [!WARNING]
> The installer is not signed, so Windows warns before running it. Download it only from this repository's Releases page, and run it only if you trust it.

- **Installed a pre-release?** Turn on "Beta versions" in Settings to keep getting updates. It is off by default, and until the first stable release there is nothing else to take.
- **Windows only, for now.** Linux is to follow: until after the first stable release it is untried, and no package of it is built.
- **Going back.** From `v1.0.0-beta.26` on, an installer older than the Scia installed refuses to run over it; one released before has no such check. Uninstall Scia first: your downloads and settings stay.

### Build from source

Node 24 or later.

```bash
npm ci          # install, and wire the git hooks
npm start       # build everything, then start the app on a scratch profile
npm run dist    # build the installer for this system
```

`npm run dev` serves the engine and the interface to a browser tab instead, on http://localhost:5173. How the project is worked on: [`CONTRIBUTING.md`](CONTRIBUTING.md) and the runbooks of [`docs/development/`](docs/development/). The architecture decisions: [`docs/adr/`](docs/adr/).

## Integrations

Scia downloads from the hosts of the links you give it, and from the servers those lead to for the files themselves. Beyond them, it reaches only these:

- **AllDebrid**, once you connect it in Settings. Its key is kept where the system protects it. Scia sends it file hosts' links and folders, protectors' and shorteners' links, and magnets, and no other link of yours; their files come from its servers. Connecting with a code asks it for a code, with no key, then every five seconds whether you confirmed it on its site. Otherwise, with no service connected, Scia asks it only for its public list of file hosts, with no key and nothing of your links.
- **yt-dlp**, shipped with Scia, reads a video's page on its site, and whatever that site's reader asks in turn. Scia downloads the video from the servers its answer names. With the clipboard on, a video's page you copy is read for its title at once, even if you never start it.
- **Bunkr**, read by a reader of Scia's own: its pages, its API, and the file servers it names.
- **GitHub**, for Scia's updates and yt-dlp's.

What each one adds, what it is sent, and how far it was seen: [`docs/product/integrations.md`](docs/product/integrations.md). Scia collects nothing.

## Support

Scia is free. If it is useful to you, you can support it through [GitHub Sponsors](https://github.com/sponsors/m-bonanno) or on [Ko-fi](https://ko-fi.com/notsosnake), which takes one-off gifts by PayPal or card. "Support Scia" in Settings opens the Ko-fi page in your browser; Scia itself sends nothing.

## Contributing

The help Scia needs most takes no code: try a beta and say what you saw, report a bug, or propose a feature. Every change starts as an issue, opened with a form, and the team opens the pull request that closes it: [`CONTRIBUTING.md`](CONTRIBUTING.md) says how, and what happens to your issue. A security problem is reported privately: [`SECURITY.md`](SECURITY.md). How the team works: [`git-flow.md`](docs/development/git-flow.md), [`review-flow.md`](docs/development/review-flow.md), [`release-flow.md`](docs/development/release-flow.md).

## Licence

[MIT](LICENSE). The installer also carries yt-dlp's own build, unchanged, under its licence: [`apps/desktop/third-party/yt-dlp`](apps/desktop/third-party/yt-dlp/README.txt); and the engine bundles mux.js, under the Apache License 2.0: [`apps/desktop/third-party/mux.js`](apps/desktop/third-party/mux.js/README.txt).
