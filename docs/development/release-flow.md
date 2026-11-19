# Release flow

**semantic-release owns versioning.** Nobody writes a version: the commits on `develop` and `main` decide it.

## Channels

| Branch    | A merge produces                       | What is published                                            |
| --------- | -------------------------------------- | ------------------------------------------------------------ |
| `develop` | `vX.Y.Z-beta.N` (a GitHub pre-release) | The tag and its notes. No installer by default               |
| `main`    | `vX.Y.Z` (a GitHub release)            | The tag, its notes, and the installers for Windows and Linux |

Which commit moves which number (`.releaserc.json`, the Angular preset):

| Commit                                                             | Release |
| ------------------------------------------------------------------ | ------- |
| `fix:`, `perf:`, `hotfix:`                                         | patch   |
| `feat:`                                                            | minor   |
| A `BREAKING CHANGE:` footer, or `type!:`                           | major   |
| `chore:`, `docs:`, `ci:`, `test:`, `refactor:`, `style:`, `build:` | none    |

This is why PR titles are checked: a squash merge makes the title the commit, and the commit makes the version.

## The Release workflow (`.github/workflows/release.yml`)

1. **Semantic release** — on every push to `develop` or `main`: reads the commits since the last tag of that channel, and if any calls for a release, creates the tag and the GitHub release with its notes. A push with nothing to release ends here, green.
2. **Installers** — only when step 1 made a **stable** tag: one job on Windows (NSIS `.exe`) and one on Linux (AppImage, `.deb`). Each checks out the tag, builds, packages with the version passed in (`-c.extraMetadata.version`), checks the files exist and are not empty, and attaches them to the release.

To get the installers of a beta, or to build again those of a stable: **Actions → Release → Run workflow**, with `installer_tag` set to the existing tag.

## Releasing

1. `develop` is green and holds what the release should contain.
2. Open a PR `develop` → `main`, titled `release: vX.Y.Z` (the number is a forecast; semantic-release decides). Body: the user-facing changes. The team reviews it like any other ([`review-flow.md`](./review-flow.md)); it is merged only on the owner's word.
3. Merge it with a **merge commit**, never a squash: `main` must contain the very commits semantic-release reads, or the next version is computed wrong.
4. Wait for the workflow, then **verify the artefact, not the build**: download the installer from the release, install it, launch it with `--user-data-dir=<scratch>`, download a file, read `logs/main.log`.
5. Merge `main` back into `develop` (a PR whose head is `main`, merge commit), so the two branches share the release's merge commit and the next beta is counted from the stable. Nobody reviews this PR, and the orchestrating session merges it when CI is green: the "Merging" table of [`review-flow.md`](./review-flow.md) says why. **Before merging it, read the repository's setting** — `gh api repos/{owner}/{repo} --jq .delete_branch_on_merge`, run from the clone as it is written, must answer `false` or `main` must be protected — and never ask for the head to be deleted: the head is `main` ([`git-flow.md`](./git-flow.md), "Repository settings").

**Before the first stable release**: shortly before it — when M1 is nearly whole, so that automatic updates are proven on a beta with installers — the repository is made public, with its licence in place (MIT, the owner's choice), and `main` and `develop` are protected ([`git-flow.md`](./git-flow.md), "Repository settings"), so that step 5 cannot delete `main` whatever the setting says. The PR that records it removes the entry on direct pushes under "Not there yet".

## Rules

- **`apps/desktop/package.json` stays at `0.0.0`.** The workflow injects the version. Never derive it from git inside the build: CI checkouts are tag checkouts.
- **Never edit or delete a published tag.** A bad release is followed by a fixed one.
- **Never push a tag by hand.** A tag semantic-release did not make confuses its next computation.
- **Closed is not released.** An issue closes when its PR merges into `develop`; it has reached people when a stable release's notes list it.
- **Private repository, Free plan**: Actions minutes are a quota, and Windows minutes count double. Keep jobs lean; installers on stable only.

## Not there yet

- **Auto-update.** The app does not look for new versions (roadmap M1). When it does, the installers must be readable without a token: the repository is made public shortly before the first stable release for this (#28).
- **A guard on direct pushes.** GitHub refuses branch protection on a private Free repository, so `main` and `develop` are protected by the husky hooks only. The repository becomes public shortly before the first stable release, and the two branches are protected then ([`git-flow.md`](./git-flow.md), "Repository settings", and "Releasing" above).
- **Signed installers.** Windows shows SmartScreen's warning for an unsigned `.exe`.
- **Linux waits, the job does not yet.** The first stable release ships for Windows only (roadmap, "After the first stable release"), while the installers job builds the Linux packages on every stable tag: the job is to be turned off until Linux is tried (the owner's decision, #28), in a PR of its own before the release PR.
- **No installer has come out of CI, and the Linux packages have never been built anywhere.** The installers job has never run: the first stable release is its first run — expect to fix it.
