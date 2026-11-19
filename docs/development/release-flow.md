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
5. Merge `main` back into `develop` (a PR, merge commit), so the two branches share the release's merge commit and the next beta is counted from the stable.

## Rules

- **`apps/desktop/package.json` stays at `0.0.0`.** The workflow injects the version. Never derive it from git inside the build: CI checkouts are tag checkouts.
- **Never edit or delete a published tag.** A bad release is followed by a fixed one.
- **Never push a tag by hand.** A tag semantic-release did not make confuses its next computation.
- **Closed is not released.** An issue closes when its PR merges into `develop`; it has reached people when a stable release's notes list it.
- **Private repository, Free plan**: Actions minutes are a quota, and Windows minutes count double. Keep jobs lean; installers on stable only.

## Not there yet

- **Auto-update.** The app does not look for new versions (roadmap M1). When it does, the installers must be readable without a token: a public releases repository, or the repository made public.
- **A guard on direct pushes.** GitHub refuses branch protection on a private Free repository, so `main` and `develop` are protected by the husky hooks only. A workflow step that refuses a pushed commit that is not the merge of a green PR is the next line of defence.
- **Signed installers.** Windows shows SmartScreen's warning for an unsigned `.exe`.
- **The Linux packages have never been built.** The first stable release is their first run: expect to fix the job.
