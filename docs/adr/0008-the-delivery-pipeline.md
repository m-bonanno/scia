# ADR 0008 — The delivery pipeline: what runs on a PR, a beta and a stable

- **Status**: accepted
- **Date**: 2026-11-20

## Context

Scia ships for Windows. On 20 November 2026 the pipeline was:

- **On a PR**, one job on Ubuntu: format, lint, types, the unit, integration and feature layers, the build (about 1 min 15 s). Nothing ran on Windows.
- **No E2E suite.** A change to the shell was proven by a harness driving the real app over the DevTools protocol, written for one PR and not committed: the speed limit, the notification when a download ends, the download folder and the AllDebrid connection were each proven once, and nothing held them afterwards.
- **On a merge into `develop` or `main`**, semantic-release tagged the commit at once. The required checks are not `strict`: a PR green against an older `develop` could be squashed into a commit no check had run on, and be published as a beta.
- **In a release**, the Windows installer was built and its files were checked to exist; nothing installed or started it. An updater that follows the betas ([ADR 0007](./0007-automatic-updates.md)) would have installed a broken one before anyone did.

The owner asked whether the pipeline had E2E, unit, integration, feature and smoke tests on every PR and release, and decided the open points on 20 November 2026, as four answers to multiple-choice questions:

1. **The E2E suite is written with `playwright-core`'s Electron driver, run by Vitest** as a project of its own.
2. **The installer is installed and started in CI on every PR, and in every release before its files are attached.** A stable is still installed by a person over the previous stable: the update path is not the smoke test's.
3. **The gates run again on the commit a merge makes, before semantic-release tags it.**
4. **A new check is advisory until it has run ten times in a row green on CI, then it is required** on `develop` and `main`. No automatic retries.

## Decision

### What runs where

| When                         | Job                                  | Runner           | What it runs                                                                                           |
| ---------------------------- | ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------ |
| Every PR, and every release  | `Format, lint, types, tests, build`  | `ubuntu-latest`  | `npm run format:check`, `lint`, `typecheck`, `npm test` (unit, integration, feature), `build`          |
| Every PR, and every release  | `Windows tests, build`               | `windows-latest` | `npm test` and `npm run build`. Format, lint and types say the same on both systems and run once       |
| Every PR, and every release  | `E2E (Windows)`                      | `windows-latest` | The E2E suite, on the built app (#91)                                                                  |
| Every PR                     | `Installer smoke (Windows)`          | `windows-latest` | The smoke test, on an installer packaged from the PR's head (#92)                                      |
| Every release, after its tag | `Installer (Windows)`                | `windows-latest` | The installer with the release's version, the smoke test on it, and only then its files attached (#92) |
| Every PR                     | `Conventional title`, `Linked issue` | `ubuntu-latest`  | Unchanged                                                                                              |

- **The gates are one reusable workflow**, `.github/workflows/gates.yml`: it runs on every PR, and `release.yml` calls it on the push a merge into `develop` or `main` makes. **semantic-release runs only when it is green**: a red commit makes no tag and no release, and the next merge that mends it releases both.
- **Linux runs what does not need a desktop.** The E2E suite and the installer run on Windows alone: Linux is not tried and has no installer job (#28), and Electron there needs a virtual display. Ubuntu keeps finding what Windows forgives — a path written with `\`, a name whose case differs.

### The layers

| Layer       | Proves                                                                                                    | Runs                                     |
| ----------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Unit        | Rules, with no IO                                                                                         | Ubuntu and Windows, every PR and release |
| Integration | Adapters against a real HTTP host and a real disk                                                         | Ubuntu and Windows, every PR and release |
| Feature     | The engine's API through `app.request()`                                                                  | Ubuntu and Windows, every PR and release |
| E2E         | The built app, started as a person starts it, with a scratch profile and a free port, against local hosts | Windows, every PR and release            |
| Smoke       | The installer: installed silently, started, one download, quit, its log read, uninstalled                 | Windows, every PR and every release      |

- **The E2E suite is `playwright-core` under Vitest** (the owner's decision 1): a fifth Vitest project, `e2e`, outside `npm test`, which needs a build. `playwright-core` has no dependency and downloads no browser; its `_electron` driver starts the app and reaches both main and the page. The specs use what the other layers already have — `until` for a state, `startRangeServer` and `startAllDebridServer` for hosts. Each spec starts the app with a temporary profile (`--user-data-dir=`) and `--port=0`, the engine taking a free port: specs never meet each other, another session's runs or an installed Scia.
- **The smoke test is a script, not a spec**: what it drives is an installer and an installed exe, on a machine where it may install. It runs only on a CI runner, never on a person's computer, where an install replaces the installed Scia.

### Keeping flaky specs out

- **No automatic retries**, in Vitest or in the workflows: a retry turns a failure into a pass and hides it. A failure is read; a spec that failed without a cause in the change is a bug of the spec or of the app, filed as an issue with its log.
- **A flaky spec is fixed, or quarantined** — skipped with the issue's number beside it — never run again until it passes. A quarantine is a debt the roadmap does not count as held.
- **The timing lessons of `.claude/gotchas.md` hold for the new layers**: a state is waited for with `until`, never a fixed sleep; a bound is set against a cold start on a CI runner, and against what the code does without the thing held; a rate is counted against a host that sends as fast as it is read.
- **A new job is advisory until its burn-in** (the owner's decision 4): it runs ten times in a row green on one commit, started by hand, before it becomes required. A job that fails its burn-in is mended first.

### What it costs

Nothing. The repository is public: GitHub's standard hosted runners, Linux and Windows, are free for it, and so are their minutes. `playwright-core` is free software (Apache-2.0). No larger runner, no paid service. Time is what it costs: a PR waits about seven minutes instead of one and a half, its jobs running side by side; a beta about seven minutes more, the gates running before the tag.

### What a person still does

- **A stable is installed over the previous stable** and run, before the release PR is called done: the smoke test installs on a clean runner, not over an earlier Scia ([`release-flow.md`](../development/release-flow.md)).
- **What the system draws and only a person sees** — a notification, the tray, a hand on the mouse, SmartScreen on a downloaded installer — stays with a person, as the roadmap lists it.
- **The author runs the gates before opening a PR** ([`review-flow.md`](../development/review-flow.md)): on this Windows machine, the E2E suite too, once it exists, when the change touches the app's runtime.

### The order it is built in

Four PRs, each closing its issue: the Windows job and the gates before a tag (#90); the E2E suite and its job (#91); the smoke test of the installer, on PRs and in the release (#92); the burn-in and the required checks (#93).

## Alternatives considered

- **`@playwright/test`**: its trace viewer and HTML report, at the cost of a second runner beside Vitest, with its own way of writing specs and retries to be turned off.
- **Committing the DevTools harnesses as they were**: no new dependency, and more code to keep — every wait, every selector and every launch written by hand.
- **The smoke test in releases only**: a packaging broken by a PR would be found after the merge, on a beta already tagged.
- **Releases as drafts, published after the smoke test**: the strictest, and a change to semantic-release's configuration and to the updater's assumptions (ADR 0007) for a gain the order "smoke, then attach" already gives — a release whose smoke test fails has no installer, and an updater has nothing to install.
- **Trusting the PR's checks on a merge**: a beta seven minutes sooner, from a commit no check ran on.
- **Required branches up to date before a merge** (`strict`): a merge of `develop` and another run for nearly every PR, with several sessions working at once.
- **The new checks required at once**: one unstable spec would block every PR of every session.

## Consequences

- A PR to `develop` or `main` waits for four jobs on two systems. A beta is published about seven minutes later than before.
- A merge whose commit is red publishes nothing; whoever merged it mends it in the next PR.
- The required checks change in #93, on the owner's word: `git-flow.md`, "Repository settings", lists them.
- A job's name is a required check's name: renaming one blocks every PR until the protection is changed with it.
