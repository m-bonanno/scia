# Scia

A download manager for Windows, with Linux to follow: paste a link, Scia fetches it over several connections, resumes it if it breaks, and asks nothing else of you.

![Scia with a few downloads in progress](docs/design/downloads-in-progress.png)

## What it does today

- Downloads any http/https link over several connections in parallel, handing work over when one finishes before the others.
- Pauses and resumes from the bytes it already has, even after the app was closed and opened again.
- Keeps downloading from the system tray when the window is closed with downloads running or waiting (Windows; Linux not yet tried); closing it with nothing left quits.
- Says when a download ends — completed or failed — with a notification of the system, while its window is not the one in use (Windows; asked of the system under a script, not yet seen or clicked; a Scia that opened behind the window in use can be silent until it has been used once, minimised, or closed into the tray; Linux not yet tried).
- Marks what it downloads as coming from the network, as a browser does, so that Windows can ask before running it (Windows; seen with a script, not yet with an `.exe`, an installer or a document); and asks for a second press itself before running a downloaded program.
- Keeps a queue: how many downloads at once and how many connections per download are settings, and so are the folder they go to and a speed limit for all of them together.
- Wears one of nine colour themes, chosen in Settings, each in a light and a dark variant that follows the system (seen on a dark system; the light variant with the page told to be light, not yet on a light one); the default one is black and white.
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

Work happens on a `<type>/<issue>-<description>` branch cut from `develop`, with conventional commits, and lands through a PR into `develop`: [`docs/development/git-flow.md`](docs/development/git-flow.md). Versions are decided by semantic-release from the commits: [`docs/development/release-flow.md`](docs/development/release-flow.md).
