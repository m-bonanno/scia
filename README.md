# Scia

A download manager for Windows and Linux: paste a link, Scia fetches it over several connections, resumes it if it breaks, and asks nothing else of you.

![Scia with a few downloads in progress](docs/design/downloads-in-progress.png)

## What it does today

- Downloads any http/https link over several connections in parallel, handing work over when one finishes before the others.
- Pauses and resumes from the bytes it already has, even after the app was closed and opened again.
- Keeps a queue: how many downloads at once and how many connections per download are settings.
- Takes links and media from the browser through the extension (`apps/extension`).

What comes next: [`docs/product/roadmap.md`](docs/product/roadmap.md).

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
