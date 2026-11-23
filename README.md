# Scia

A download manager for Windows: paste a link, and Scia fetches it over several connections, resumes it if it breaks, and asks nothing else of you.

[![Latest release](https://img.shields.io/github/v/release/m-bonanno/scia?include_prereleases&sort=semver&label=release)](https://github.com/m-bonanno/scia/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/m-bonanno/scia/release.yml?branch=develop&label=CI)](https://github.com/m-bonanno/scia/actions/workflows/release.yml)
[![Licence: MIT](https://img.shields.io/github/license/m-bonanno/scia?label=licence)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/badge/sponsor-on%20GitHub-ea4aaa?logo=githubsponsors)](https://github.com/sponsors/m-bonanno)

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/design/downloads-in-progress-light.png">
  <img alt="Scia's list of downloads: one queued, three running, two of them over several connections, one failed and one finished" src="docs/design/downloads-in-progress.png">
</picture>

## What it does

- ⚡ **Several connections at once** for any http or https link.
- ⏯️ **Pause and resume**, also after Scia was closed and opened again.
- 🚦 **A queue**: simultaneous downloads, connections per download, a speed limit.
- 🖥️ **The system tray**: close the window, and the downloads go on.
- 🔔 **Notifications** when a download completes or fails.
- 🎨 **Nine colour themes**, each light and dark, following the system.
- 🔄 **Updates itself** from this repository's releases, without stopping a download.
- 📋 **Links you copy**, if you turn it on, wait as "Ready"; a video's by its title.
- 🎬 **The video a page plays**, via yt-dlp: one file, an HLS stream, or picture and sound.
- 🔗 **AllDebrid**, by a code or a key: file hosts' links, folders, magnets, your account's too.
- 🖼️ **Bunkr albums**, every file into a folder named after the album.
- 🛡️ **Downloads marked as from the network**, and a second press to run a program.
- 🧩 **A browser extension** to hand Scia links: not yet tried in a browser, nor published.

All of it is built and held by tests. Much of it is still to be seen by a person in the installed app, and against the real services and sites it reaches — a download through AllDebrid to its end, the real Bunkr, a real site's stream, picture and sound, and title — before the first stable release; none of it has been tried on Linux. What was seen of each feature, and how: [`docs/product/evidence.md`](docs/product/evidence.md). What is left and what comes next: [`docs/product/roadmap.md`](docs/product/roadmap.md).

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

`npm run dev` serves the engine and the interface to a browser tab instead, on http://localhost:5173. How the project is built and how to work on it: [`CLAUDE.md`](CLAUDE.md). The architecture decisions: [`docs/adr/`](docs/adr/).

## Integrations

Scia downloads from the hosts of the links you give it, and from the servers those lead to for the files themselves. Beyond them, it reaches only these:

- **AllDebrid**, once you connect it in Settings. Its key is kept where the system protects it, and the files of the links it unlocks come from its servers. With no service connected, Scia asks it only for its public list of file hosts, with no key and nothing of your links.
- **yt-dlp**, shipped with Scia, reads a video's page on its site, and whatever that site's reader asks in turn. Scia downloads the video from the servers its answer names. With the clipboard on, a video's page you copy is read for its title at once, also when you never start it.
- **Bunkr**, read by a reader of Scia's own: its pages, its API, and the file servers it names.
- **GitHub**, for Scia's updates and yt-dlp's.

What each one adds, what it is sent, and how far it was seen: [`docs/product/integrations.md`](docs/product/integrations.md). Scia collects nothing.

## Support

Scia is free. If it is useful to you, you can support it through [GitHub Sponsors](https://github.com/sponsors/m-bonanno) or on [Ko-fi](https://ko-fi.com/notsosnake), which takes one-off gifts by PayPal or card. "Support Scia" in Settings opens the Ko-fi page in your browser; Scia itself sends nothing.

## Contributing

Every change starts as an issue — a bug or a proposal, opened with a form — and the team opens the pull request that closes it: [`CONTRIBUTING.md`](CONTRIBUTING.md) says how, and what happens to your issue. How the team works: [`git-flow.md`](docs/development/git-flow.md), [`review-flow.md`](docs/development/review-flow.md), [`release-flow.md`](docs/development/release-flow.md).

## Licence

[MIT](LICENSE). The installer also carries yt-dlp's own build, unchanged, under its licence: [`apps/desktop/third-party/yt-dlp`](apps/desktop/third-party/yt-dlp/README.txt); and the engine bundles mux.js, under the Apache License 2.0: [`apps/desktop/third-party/mux.js`](apps/desktop/third-party/mux.js/README.txt).
