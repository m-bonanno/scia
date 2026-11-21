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
3. **Installers** — for every tag step 2 made, beta or stable: one job on Windows (NSIS `.exe`), whose packing fetches yt-dlp at the version and checksum `apps/desktop/src/engine/runtime-layout.ts` fixes (`scripts/fetch-tools.ts`), and refuses any other bytes (`beforePack`, [ADR 0009](../adr/0009-the-video-of-a-page.md)). The Linux job (AppImage, `.deb`) is off until Linux is tried (the owner, #28): the workflow keeps its entry in a comment. The job checks out the tag, builds, packages with the version passed in (`-c.extraMetadata.version`), checks the files exist and are not empty, **installs the installer on the runner and runs the smoke test on it** — started on a scratch profile, a download from a local host, quit, its log read, uninstalled ([`testing.md`](./testing.md), "The installer's smoke test") — and only then attaches them to the release: `Scia-Setup-<v>.exe`, its `.blockmap` and `latest.yml`, which the updater reads ([ADR 0007](../adr/0007-automatic-updates.md)). electron-builder writes the last two because `electron-builder.yml` names this repository under `publish`; it uploads nothing itself (`--publish never`). The release is published before its files: for a few minutes — the job itself took between 1 min 39 s and 2 min 45 s in its first three runs, before it ran the smoke test — the newest release carries notes only, and an updater that reads it then tries again later. **A release whose smoke test fails keeps notes only**: nothing is attached, no updater is offered its installer, and the next release mends it — the tag is never edited. A smoke test that failed without a cause in the release is filed with its log (`testing.md`, "No retries"), and once it is mended the files are built and attached again with `installer_tag`, below.

To build again the files of a tag: **Actions → Release → Run workflow**, with `installer_tag` set to the existing tag. A tag made before #83 has no `publish` in its `electron-builder.yml`: its run stops at the check of `latest.yml`; one made before #92 has no smoke test, and its run stops at that step: neither attaches anything.

### A merge nothing released

GitHub once recorded no push for a merge into `develop`. No workflow started, and the merge reached no beta until a person noticed and started the Release workflow by hand (#95). Two things catch it now:

- **Whoever merges reads the run.** After a merge into `develop` or `main`, `gh run list --workflow Release --commit <merge sha>` must list a run. When none has started a minute after the merge, the merger starts it with `gh workflow run release.yml --ref <develop|main>` and no `installer_tag`: the gates, then semantic-release, as the push would have done (`/team-review`, step 10).
- **The Release watch** (`.github/workflows/release-watch.yml`) does the same for `develop` every three hours. When `develop`'s head is more than ten minutes old and has no Release run, it starts one and leaves a warning on its own run. It also fails its own run, naming what it found, when the newest Release run on `develop`'s head ended any way but success — failed, never started, timed out or cancelled, also by a person — or a `v*` tag has no GitHub release or no notes ref — the case of "A tag pushed without its notes", below, which failed three runs in a row before anyone saw it (`scripts/release-health.mjs`, #185). It never watches `main`: a stable release is started by a person, on the owner's word. Two limits: any Release run on the head counts, even one started by hand with `installer_tag` only to rebuild files; and GitHub turns a scheduled workflow off after 60 days with no activity in the repository, which the watch's own runs do not count as. When it has been turned off, **Actions → Release watch** shows it, and it is turned on again there.

### A tag pushed without its notes

semantic-release pushes the new tag, then its notes, `refs/notes/semantic-release-<tag>`, and then makes the GitHub release. Once, GitHub refused the notes with a bare `(failed)` after it had taken the tag (#160): `v1.0.0-beta.20` stood on GitHub with no release, no installer and no notes. Every later run then stopped on `git tag v1.0.0-beta.20` because the tag existed, and #145 and #149 made no beta.

How to tell this case:

- a Release run failed in its "Semantic release" job, at the `semantic-release` step, on the push of the notes, or on a `git tag` of a tag that exists;
- `gh release list` has no release for that tag;
- `git ls-remote origin 'refs/notes/semantic-release-<tag>'` answers nothing.

Mending it moves a tag, so it is done **only on the owner's word**:

1. Delete the unreleased tag on GitHub: `git push origin --delete <tag>`. This is allowed only because nothing was ever released under it: no GitHub release, so no installer and no `latest.yml` that an installed Scia could have read. A tag with a release is never touched (Rules).
2. Start the Release workflow on the branch whose run pushed the tag, with no `installer_tag`: `gh workflow run release.yml --ref <develop|main>`. semantic-release makes the tag again, on the branch's head, with everything merged since, then its notes and its release. Read that the release carries its installer and `latest.yml`, and that the notes ref is there.

On `main` the case does not show itself. semantic-release keeps a stable tag whatever its notes say (`get-last-release.js` in version 25), so the next run takes the unreleased stable as released and goes on, green: later runs never fail on `git tag`, and only the first run's failure, the missing release and the missing notes ref show it. A stable tag with no release is mended before the next merge into `main`, and before `main` is merged back into `develop`, whose next beta would otherwise be counted from the unreleased stable.

## Releasing

1. `develop` is green and holds what the release should contain.
2. Open a PR `develop` → `main`, titled `release: vX.Y.Z` (the number is a forecast; semantic-release decides). Body: the user-facing changes. The team reviews it like any other ([`review-flow.md`](./review-flow.md)); it is merged only on the owner's word.
3. Merge it with a **merge commit**, never a squash: `main` must contain the very commits semantic-release reads, or the next version is computed wrong.
4. Read that a Release run started for the merge commit, and start it if none did ("A merge nothing released", above). Then wait for the workflow. Its smoke test has installed **the artefact, not the build** on a clean runner, started it, downloaded a file and read its log before attaching it ([`testing.md`](./testing.md), "The installer's smoke test"). What it cannot do is a person's: **install the stable from the release over the previous stable, when there is one**, launch it with `--user-data-dir=<scratch>`, download a file, read `logs/main.log` — the update path, which the clean runner never takes. An installed Scia updates itself ([ADR 0007](../adr/0007-automatic-updates.md)): one that finds a newer release downloads it while it downloads nothing else, and installs it at the quit from the tray, or at a close with nothing left — the version verified is then gone. A run that must keep it quits before an update is downloaded (`update_ready` in the log), or follows the stables while the newest release is a beta.
5. Merge `main` back into `develop` (a PR whose head is `main`, merge commit), so the two branches share the release's merge commit and the next beta is counted from the stable. Nobody reviews this PR, and the orchestrating session merges it when CI is green: the "Merging" table of [`review-flow.md`](./review-flow.md) says why. **Before merging it, read the repository's setting** — `gh api repos/{owner}/{repo} --jq .delete_branch_on_merge`, run from the clone as it is written, must answer `false`; `main` is protected against deletion too, so the two guard each other (`gh api repos/{owner}/{repo}/branches/main --jq .protected`) — and never ask for the head to be deleted: the head is `main` ([`git-flow.md`](./git-flow.md), "Repository settings").

## Rules

- **`apps/desktop/package.json` stays at `0.0.0`.** The workflow injects the version. Never derive it from git inside the build: CI checkouts are tag checkouts.
- **Never edit or delete a published tag** — one with a GitHub release. A bad release is followed by a fixed one.
- **Never push a tag by hand.** A tag semantic-release did not make confuses its next computation. The only tag that may be deleted by hand is one semantic-release pushed and never released, on the owner's word ("A tag pushed without its notes", above).
- **Closed is not released.** An issue closes when its PR merges into `develop`; it has reached people when a stable release's notes list it.
- **Every release carries its installer and the updater's files**, beta or stable (the owner, 20 November 2026, #82): an installed Scia follows the stables, and the betas when its switch in Settings is on, and reads them from the releases. The repository is public, so GitHub's runners cost nothing.

## Not there yet

- **Auto-update of a stable.** An installed Scia updates itself from the releases of this repository ([ADR 0007](../adr/0007-automatic-updates.md)), and was seen to from a build of its branch to `v1.0.0-beta.13` (#82); no stable release exists yet, so none has been taken, and a Scia that follows the stables finds nothing until `v1.0.0`.
- **Signed installers.** Windows shows SmartScreen's warning for an unsigned `.exe`, at the first install; an update is not signed either, and is checked only against the SHA-512 of its release's `latest.yml` (ADR 0007).
- **Linux.** The first stable release ships for Windows only, and the Linux job of the workflow is off until Linux is tried (roadmap, "After the first stable release").
- **The Linux packages have never been built anywhere.** The Windows installer came out of CI three times on request (`v1.0.0-beta.10` to `.12`), and with every release from `v1.0.0-beta.13` on, with `latest.yml` and the blockmap (#83) — `v1.0.0-beta.13`'s run dispatched by hand, because GitHub recorded no push for the merge before it (#95). `v1.0.0-beta.10` and `v1.0.0-beta.12` were installed and run (#78), and `v1.0.0-beta.13` installed by the updater and run (#82).
