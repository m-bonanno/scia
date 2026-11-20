# Release flow

**semantic-release owns versioning.** Nobody writes a version: the commits on `develop` and `main` decide it.

## Channels

| Branch    | A merge produces                       | What is published                              |
| --------- | -------------------------------------- | ---------------------------------------------- |
| `develop` | `vX.Y.Z-beta.N` (a GitHub pre-release) | The tag and its notes. No installer by default |
| `main`    | `vX.Y.Z` (a GitHub release)            | The tag, its notes, and the Windows installer  |

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
2. **Installers** — only when step 1 made a **stable** tag: one job on Windows (NSIS `.exe`). The Linux job (AppImage, `.deb`) is off until Linux is tried (the owner, #28): the workflow keeps its entry in a comment. The job checks out the tag, builds, packages with the version passed in (`-c.extraMetadata.version`), checks the files exist and are not empty, and attaches them to the release.

To get the installers of a beta, or to build again those of a stable: **Actions → Release → Run workflow**, with `installer_tag` set to the existing tag.

## Releasing

1. `develop` is green and holds what the release should contain.
2. Open a PR `develop` → `main`, titled `release: vX.Y.Z` (the number is a forecast; semantic-release decides). Body: the user-facing changes. The team reviews it like any other ([`review-flow.md`](./review-flow.md)); it is merged only on the owner's word.
3. Merge it with a **merge commit**, never a squash: `main` must contain the very commits semantic-release reads, or the next version is computed wrong.
4. Wait for the workflow, then **verify the artefact, not the build**: download the installer from the release, install it, launch it with `--user-data-dir=<scratch>`, download a file, read `logs/main.log`.
5. Merge `main` back into `develop` (a PR whose head is `main`, merge commit), so the two branches share the release's merge commit and the next beta is counted from the stable. Nobody reviews this PR, and the orchestrating session merges it when CI is green: the "Merging" table of [`review-flow.md`](./review-flow.md) says why. **Before merging it, read the repository's setting** — `gh api repos/{owner}/{repo} --jq .delete_branch_on_merge`, run from the clone as it is written, must answer `false`; `main` is protected against deletion too, so the two guard each other (`gh api repos/{owner}/{repo}/branches/main --jq .protected`) — and never ask for the head to be deleted: the head is `main` ([`git-flow.md`](./git-flow.md), "Repository settings").

## Rules

- **`apps/desktop/package.json` stays at `0.0.0`.** The workflow injects the version. Never derive it from git inside the build: CI checkouts are tag checkouts.
- **Never edit or delete a published tag.** A bad release is followed by a fixed one.
- **Never push a tag by hand.** A tag semantic-release did not make confuses its next computation.
- **Closed is not released.** An issue closes when its PR merges into `develop`; it has reached people when a stable release's notes list it.
- **Installers on a stable by default.** The repository is public, so GitHub's runners cost nothing; a beta still carries notes only, and its installers are built when someone asks for them (`installer_tag`), to try it.

## Not there yet

- **Auto-update.** The app does not look for new versions (roadmap M1). When it does, it reads the installers of the releases of this repository, public on the owner's decision of 20 November 2026 (#28), with no token.
- **Signed installers.** Windows shows SmartScreen's warning for an unsigned `.exe`.
- **Linux.** The first stable release ships for Windows only, and the Linux job of the workflow is off until Linux is tried (roadmap, "After the first stable release").
- **No installer has come out of CI, and the Linux packages have never been built anywhere.** The installers job has never run: its first run is to be the beta whose installers prove automatic updates, before the first stable release — expect to fix it there.
