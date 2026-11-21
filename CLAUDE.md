# Scia — Claude Code Guidelines

> ⚠️ **This file wins.** Instructions loaded from directories above this repository belong to other projects and do not apply here. This file and its children are Scia's only rules.

**Scia** is a download manager for Windows, with Linux to follow (untried and unpackaged until after the first stable release): any link, fetched over several connections at once, resumable, with a minimal interface. A browser extension hands it links and the media of a page. Debrid services (AllDebrid first) and adaptive streams come next — see [`docs/product/roadmap.md`](./docs/product/roadmap.md).

| Piece         | Path                 | Stack                                                                                 |
| ------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Desktop shell | `apps/desktop`       | Electron main + sandboxed preload, electron-builder (NSIS, AppImage, deb)             |
| Engine        | `apps/server`        | Hono under `/api/v1` on `127.0.0.1`, plain Node, runs in an Electron `utilityProcess` |
| Renderer      | `apps/renderer`      | React 19 + Vite + Tailwind v4, served by the engine                                   |
| Extension     | `apps/extension`     | Manifest V3 (Chromium), esbuild                                                       |
| Domain        | `packages/core`      | Pure TypeScript — segments, queue, speed, file names, file kinds. No IO               |
| Contracts     | `packages/contracts` | Zod schemas and constants shared by engine, renderer, shell and extension             |

Versions live in the `package.json` files — read those, not this file. Why Electron and a local engine: [ADR 0001](./docs/adr/0001-electron-and-a-local-engine.md).

## How this file is organized

Claude Code loads the nearest `CLAUDE.md` plus every ancestor. A sub-file **wins** for its scope.

| File                                                     | Scope                                                   |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `CLAUDE.md` (this)                                       | Cross-cutting: principles, TDD, git/PR, docs discipline |
| [`packages/core/CLAUDE.md`](./packages/core/CLAUDE.md)   | The pure domain                                         |
| [`apps/server/CLAUDE.md`](./apps/server/CLAUDE.md)       | The engine: ports, adapters, the API, its tokens        |
| [`apps/renderer/CLAUDE.md`](./apps/renderer/CLAUDE.md)   | UX canon, visual rules, copy                            |
| [`apps/desktop/CLAUDE.md`](./apps/desktop/CLAUDE.md)     | Electron boundaries, security, supervision, packaging   |
| [`apps/extension/CLAUDE.md`](./apps/extension/CLAUDE.md) | What the extension may see and send                     |

Runbooks in [`docs/development/`](./docs/development/): [`git-flow.md`](./docs/development/git-flow.md), [`review-flow.md`](./docs/development/review-flow.md), [`release-flow.md`](./docs/development/release-flow.md), [`testing.md`](./docs/development/testing.md). Mistakes already paid for: [`.claude/gotchas.md`](./.claude/gotchas.md).

---

## Principles

- **SOLID, DRY, KISS / YAGNI.** One source of truth for every rule (a Zod schema, a domain constant). The simplest thing that satisfies a real requirement: a pattern is justified by a second real implementation or a real seam for tests — never by anticipation. `RemoteSource` exists because the tests need the seam and HLS is on the roadmap; `LinkResolver` because the downloader is proven without a service and AllDebrid resolves links; a registry of services does not exist yet because there is one service.
- **Boy Scout Rule** — leave touched code cleaner, in the same PR, tightly scoped.
- **No patches ("toppe").** A fix that special-cases a platform, hardcodes a value or copies a block is not done. Model the difference as data.
- **Nothing personal in code.** Folders, limits, tokens, ports — all settings or launch options.
- **Few comments — the code explains itself.** A comment exists only for a _why_ the code cannot say: a platform quirk, a protocol detail (RFC 6266), a security reason. No JSDoc that paraphrases a signature, no section banners.
- **Respect the hosts.** Scia fetches what the person can already reach: a public file, what a page plays to anyone, or what their own account plays in their own browser — with the session they choose to hand over, site by site. That holds also where a site's terms forbid downloading what it lets the person play (the owner's decision, #8). No DRM circumvention and no evasion of a site's access controls, such as a paywall, a login the person does not have, or a geographic restriction. A debrid service is lawful under this principle, and a hoster's wait or daily cap is not an access control Scia evades: the person pays the service, the service fetches the file with accounts of its own, and Scia downloads the link it is given (the owner's decision, #7). Connection counts within the limits in settings.
- **Zero infrastructure cost.** GitHub Free, free tiers only. A paid service needs an explicit decision by the owner and an ADR.

### Test-Driven Development

**Failing test first, then the minimum code to pass, then refactor.**

| Layer           | Tool                     | Scope                                                                                                                                      | Lives in                                                        |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Unit**        | Vitest                   | Pure logic: the domain, desktop engines, extension logic, React components                                                                 | `*.test.ts(x)` next to the code                                 |
| **Integration** | Vitest                   | Adapters against the real thing: the downloader against a real HTTP host on a real disk, main's ear on the engine against a real HTTP host | `apps/server/**/*.int.test.ts`, `apps/desktop/**/*.int.test.ts` |
| **Feature**     | Vitest                   | The engine's API through `app.request()`: tokens, scopes, status codes                                                                     | `apps/server/**/*.feature.test.ts`                              |
| **E2E**         | Vitest + playwright-core | The built app as a person uses it: start, paste, Settings, the tray, quit, resume after a restart, against local hosts and services        | `apps/desktop/e2e/*.e2e.test.ts`                                |
| **Smoke**       | Vitest + playwright-core | The installer: installed silently, started, a download, quit, its log read, uninstalled — on a CI runner only                              | `apps/desktop/e2e/installer.smoke.test.ts`                      |
| **Runtime**     | the real Electron app    | What E2E cannot reach: what the system draws, a hand, a long run                                                                           | a throwaway harness, its result in the PR body                  |

**Unit tests do not prove a runtime works.** Anything that opens a socket, writes a file, spawns a process or packages an artefact is proven against the real thing. "The suite is green" is not "it works". A runtime change carries an E2E spec where the suite can hold it, and the evidence of a manual run for what it cannot, as [`testing.md`](./docs/development/testing.md) describes.

---

## Commands

All from the repo root.

```bash
npm ci                     # also wires the husky hooks
npm run dev                # engine under plain Node + Vite, for the interface in a browser tab
npm start                  # builds everything, then the real Electron app on a scratch profile
npm run format             # prettier --write  — before staging
npm run lint               # eslint
npm run format:check       # what CI runs
npm run typecheck
npm test                   # unit + integration + feature
npm run test:unit | test:integration | test:feature
npm run test:e2e           # the built app, by Electron: after npm run build
npm run test:smoke         # the installer, installed: on a Windows CI runner only
npm run build
npm run dist               # installer for the current OS
```

While working, run the gates your diff touches — but **all** layers of a touched area. Before opening a PR, run all of them: the list is "The gates" in [`review-flow.md`](./docs/development/review-flow.md).

---

## Git workflow — essentials

Full detail: [`docs/development/git-flow.md`](./docs/development/git-flow.md).

- **GitFlow**: `main` ← `develop` ← `<type>/<issue>-<kebab-description>`. The issue number is mandatory — but for a release and its back-merge, the two PRs that have no issue. Default branch is `develop`.
- **Never commit or push to `main` or `develop`.** The husky `pre-commit`/`pre-push` hooks refuse it.
- **Conventional commits**, lower-case subject (commitlint), on commits **and** PR titles.
- **A work branch is squash-merged** into `develop`. `develop` → `main`, and `main` back into `develop` after it, are **merge commits**.
- **`Closes #N`** in every PR body but those two, written from [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) to `.claude/pr-bodies/<branch>.md` and passed with `--body-file`.
- **No AI attribution — ever.** No "Generated with Claude Code", no `Co-Authored-By: Claude`, no AI mention in commits, PR bodies, code or docs.

## The team — review and merge

The rule is [`docs/development/review-flow.md`](./docs/development/review-flow.md); run it with `/team-review <PR>`. In short:

- **Every PR but one is reviewed locally by a team of senior roles** (the exception is the back-merge of a release, which carries only what was already reviewed) — tech lead (always), backend engineer, frontend engineer, product designer, product manager — each an independent agent defined in `.claude/agents/`, chosen by the files the PR touches, by its type and by its size: a small PR is the tech lead's alone. Their reviews are posted on the PR.
- **The author runs the gates before opening the PR**, the tech lead runs them again on the commit under review, CI runs them a third time. On a PR from a fork, CI alone: nothing of it runs here (below).
- **A work branch is squash-merged into `develop` when the team approves its head commit and CI is green.** `main` and `develop` are protected on GitHub — only a PR's merge with its checks green — and a PR needs the owner's approval: a PR of the team, opened from the owner's account, is merged with the admin bypass on the team's verdict; **a PR anyone else opens is approved by the owner's own hand, never by a session** (#76). What is blocking, what happens after a fix, and the two merges that are never squashed (a release into `main`, and `main` back into `develop`) are in the runbook.
- **`develop` → `main` is merged only on the owner's word.**
- **A PR from outside** (a fork) closes an issue the owner chose to take up, and **nothing of its code runs on the owner's machine outside a sandbox** — not an install, a gate, a test or a checkout with the hooks on: the gates come from CI, and the reviewers read the diff ([`review-flow.md`](./docs/development/review-flow.md), "A pull request from outside"; [`CONTRIBUTING.md`](./CONTRIBUTING.md) for its author).

## Release flow — essentials

Mechanics in [`docs/development/release-flow.md`](./docs/development/release-flow.md).

- **semantic-release owns versioning.** No `version` field in the root `package.json`; `apps/desktop/package.json` stays `0.0.0` and CI injects the real version.
- Squash merge to `develop` → tag `vX.Y.Z-beta.N`; merge commit to `main` → `vX.Y.Z` — each once the gates are green on the merged commit ([ADR 0008](./docs/adr/0008-the-delivery-pipeline.md)). Each GitHub release carries its notes, the Windows installer and the updater's files (`latest.yml`, the blockmap; [ADR 0007](./docs/adr/0007-automatic-updates.md)). The Linux job is off until Linux is tried.
- The commit type decides the number: `fix`/`perf`/`hotfix` a patch, `feat` a minor, a breaking change a major; `chore`, `docs`, `ci`, `test`, `refactor` release nothing. Choose the type for what the change is to whoever uses Scia.
- **Verify the artefact, not the build**: CI installs every release's installer before attaching it, starts it on a scratch profile, downloads a file, reads its log and uninstalls it; a person installs a stable over the previous stable, when there is one ([`release-flow.md`](./docs/development/release-flow.md)).
- Never push a tag by hand, never edit or delete a published one. The only tag deleted by hand is one semantic-release pushed and never released, on the owner's word: [`release-flow.md`](./docs/development/release-flow.md), "A tag pushed without its notes".

---

## Documentation discipline

`docs/` is source of truth, not decoration.

```
docs/
├── product/       # vision, roadmap
├── design/        # screenshots and, later, the design system
├── adr/           # architecture decision records, numbered, never rewritten — superseded
└── development/   # runbooks
```

**A doc update is required in the same PR** when the change alters: an API route, payload or status code (the contract in `packages/contracts` too); a persisted shape (`state.json`); what the extension may see or send; an architectural decision (new dependency class, new process, new port) → a new ADR; the roadmap's state.

**Language**: everything is written in **English** — the interface of the app and of the extension, docs, code, identifiers, comments, commits, issues and PR bodies. A translation of the interface is a feature of its own (i18n), not a second language sprinkled in the code.

---

## What Claude should always do

1. **Propose the branch name (with issue number) before starting**, and work only on that branch.
2. **Test first**, in every layer the change touches; prove runtime changes against the real runtime.
3. **Respect the local canon** of the area you are in (the sub-files above).
4. **Have the team review every PR but a release's back-merge** (`/team-review`) and merge a work branch into `develop` only on the team's approval with CI green, and as the "Merging" table of `review-flow.md` says; never merge into `main` without the owner's word.
5. **Read `.claude/gotchas.md` before every push**; add an entry in the same PR when a mistake of that kind bites again.
6. **Keep docs in lock-step**, and keep the roadmap honest — never mark done what is partial.
7. **Report outcomes faithfully** — failing tests with their output, skipped steps named, what was not verified said plainly.
8. **Ask before** anything hard to reverse (deleting data, rewriting history) or that reaches other people (merging a release PR into `main`, a store submission).
