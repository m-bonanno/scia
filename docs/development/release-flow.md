# Release flow

**semantic-release owns versioning.** Nobody writes a version: the commits on `develop` and `main` decide it.

## Channels

| Branch    | A merge produces                       | What is published                                                    |
| --------- | -------------------------------------- | -------------------------------------------------------------------- |
| `develop` | `vX.Y.Z-beta.N` (a GitHub pre-release) | The tag, its notes, the Windows installer and what the updater reads |
| `main`    | `vX.Y.Z` (a GitHub release)            | The same                                                             |

Which commit moves which number (`.releaserc.json`, the Angular preset):

| Commit                                                             | Release |
| ------------------------------------------------------------------ | ------- |
| `fix:`, `perf:`, `hotfix:`                                         | patch   |
| `feat:`                                                            | minor   |
| A `BREAKING CHANGE:` footer, or `type!:`                           | major   |
| `chore:`, `docs:`, `ci:`, `test:`, `refactor:`, `style:`, `build:` | none    |

This is why PR titles are checked: a squash merge makes the title the commit, and the commit makes the version.

## The Release workflow (`.github/workflows/release.yml`)

1. **Gates** — on every push to `develop` or `main`: the gates of every PR (`gates.yml`, on Ubuntu and Windows), run again on the commit the merge made. A PR green against an older `develop` can still make a red commit; a red commit is not released, and the next merge that mends it releases both ([ADR 0008](../adr/0008-the-delivery-pipeline.md)). A merge pushed while an earlier run's gates are running makes that earlier run's semantic-release find the branch — `develop` or `main` — ahead of its commit: it releases nothing, green, and the later run releases both.
2. **Semantic release** — once the gates are green: reads the commits since the last tag of that channel, and if any calls for a release, creates the tag and the GitHub release with its notes. A push with nothing to release ends here, green.
3. **Installers** — for every tag step 2 made, beta or stable: one job on Windows (NSIS `.exe`). The Linux job (AppImage, `.deb`) is off until Linux is tried (the owner, #28): the workflow keeps its entry in a comment. The job checks out the tag, builds, packages with the version passed in (`-c.extraMetadata.version`), checks the files exist and are not empty, **installs the installer on the runner and runs the smoke test on it** — started on a scratch profile, a download from a local host, quit, its log read, uninstalled ([`testing.md`](./testing.md), "The installer's smoke test") — and only then attaches them to the release: `Scia-Setup-<v>.exe`, its `.blockmap` and `latest.yml`, which the updater reads ([ADR 0007](../adr/0007-automatic-updates.md)). electron-builder writes the last two because `electron-builder.yml` names this repository under `publish`; it uploads nothing itself (`--publish never`). The release is published before its files: for a few minutes — the job itself took between 1 min 39 s and 2 min 45 s in its first three runs — the newest release carries notes only, and an updater that reads it then tries again later. **A release whose smoke test fails keeps notes only**: nothing is attached, no updater is offered its installer, and the next release mends it — the tag is never edited.

To build again the files of a tag: **Actions → Release → Run workflow**, with `installer_tag` set to the existing tag. A tag made before #83 has no `publish` in its `electron-builder.yml`: its run stops at the check of `latest.yml`; one made before #92 has no smoke test, and its run stops at that step: neither attaches anything.

## Releasing

1. `develop` is green and holds what the release should contain.
2. Open a PR `develop` → `main`, titled `release: vX.Y.Z` (the number is a forecast; semantic-release decides). Body: the user-facing changes. The team reviews it like any other ([`review-flow.md`](./review-flow.md)); it is merged only on the owner's word.
3. Merge it with a **merge commit**, never a squash: `main` must contain the very commits semantic-release reads, or the next version is computed wrong.
4. Wait for the workflow. Its smoke test has installed **the artefact, not the build** on a clean runner, started it, downloaded a file and read its log before attaching it ([`testing.md`](./testing.md), "The installer's smoke test"). What it cannot do is a person's: **install the stable from the release over the previous stable, when there is one**, launch it with `--user-data-dir=<scratch>`, download a file, read `logs/main.log` — the update path, which the clean runner never takes. An installed Scia updates itself ([ADR 0007](../adr/0007-automatic-updates.md)): one that finds a newer release downloads it while it downloads nothing else, and installs it at the quit from the tray, or at a close with nothing left — the version verified is then gone. A run that must keep it quits before an update is downloaded (`update_ready` in the log), or follows the stables while the newest release is a beta.
5. Merge `main` back into `develop` (a PR whose head is `main`, merge commit), so the two branches share the release's merge commit and the next beta is counted from the stable. Nobody reviews this PR, and the orchestrating session merges it when CI is green: the "Merging" table of [`review-flow.md`](./review-flow.md) says why. **Before merging it, read the repository's setting** — `gh api repos/{owner}/{repo} --jq .delete_branch_on_merge`, run from the clone as it is written, must answer `false`; `main` is protected against deletion too, so the two guard each other (`gh api repos/{owner}/{repo}/branches/main --jq .protected`) — and never ask for the head to be deleted: the head is `main` ([`git-flow.md`](./git-flow.md), "Repository settings").

## Rules

- **`apps/desktop/package.json` stays at `0.0.0`.** The workflow injects the version. Never derive it from git inside the build: CI checkouts are tag checkouts.
- **Never edit or delete a published tag.** A bad release is followed by a fixed one.
- **Never push a tag by hand.** A tag semantic-release did not make confuses its next computation.
- **Closed is not released.** An issue closes when its PR merges into `develop`; it has reached people when a stable release's notes list it.
- **Every release carries its installer and the updater's files**, beta or stable (the owner, 20 November 2026, #82): an installed Scia follows the stables, and the betas when its switch in Settings is on, and reads them from the releases. The repository is public, so GitHub's runners cost nothing.

## Not there yet

- **Auto-update of a stable.** An installed Scia updates itself from the releases of this repository ([ADR 0007](../adr/0007-automatic-updates.md)), and was seen to from a build of its branch to `v1.0.0-beta.13` (#82); no stable release exists yet, so none has been taken, and a Scia that follows the stables finds nothing until `v1.0.0`.
- **Signed installers.** Windows shows SmartScreen's warning for an unsigned `.exe`, at the first install; an update is not signed either, and is checked only against the SHA-512 of its release's `latest.yml` (ADR 0007).
- **Linux.** The first stable release ships for Windows only, and the Linux job of the workflow is off until Linux is tried (roadmap, "After the first stable release").
- **The Linux packages have never been built anywhere.** The Windows installer came out of CI three times on request (`v1.0.0-beta.10` to `.12`), and with every release from `v1.0.0-beta.13` on, with `latest.yml` and the blockmap (#83) — `v1.0.0-beta.13`'s run dispatched by hand, because GitHub recorded no push for the merge before it (#95). `v1.0.0-beta.10` and `v1.0.0-beta.12` were installed and run (#78), and `v1.0.0-beta.13` installed by the updater and run (#82).
