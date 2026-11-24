# Git flow

`main` ← `develop` ← `<type>/<issue>-<kebab-description>`.

- `main` is what was released. `develop` is the default branch, where work lands.
- A branch is cut from `develop` for one issue: `feat/12-tray-icon`, `fix/31-resume-after-sleep`. Types are those of `commitlint.config.js`.
- **Nobody commits or pushes to `main` or `develop`.** `.husky/pre-commit` and `.husky/pre-push` refuse it (`protected-branch-guard.sh`). Automation that legitimately must sets `HUSKY=0`.
- Commits follow Conventional Commits with a lower-case subject; `.husky/commit-msg` runs commitlint.
- When `develop` moves ahead, merge it into the branch. No rebase of pushed work, no force-push.
- A work branch is **squash-merged** into `develop`, the PR title becoming the commit. `develop` → `main` is a **merge commit**, so `main` keeps every change that went into a release, and so is `main` back into `develop` after it. Who merges what, and when: [`review-flow.md`](./review-flow.md).

## A pull request

1. Title: `type(scope): description`, lower-case.
2. Body from `.github/PULL_REQUEST_TEMPLATE.md`, in English, written to `.claude/pr-bodies/<branch>.md` and passed with `gh pr create --body-file`.
3. `Closes #N` in the body, naming the issue the PR is for: the `Linked issue` check fails a PR whose body closes no issue of this repository (`scripts/linked-issue.mjs`).
4. Before opening it, run the gates locally: the list is in [`review-flow.md`](./review-flow.md#the-gates).
5. The team reviews it. When it is merged, how, and on whose word depends on the kind of PR: the "Merging" table of [`review-flow.md`](./review-flow.md).
6. No AI attribution anywhere.
7. **Labelled and assigned when it is opened** (the owner, #225): `gh pr create … --assignee @me --label <type>` (assigned to whoever opens it: the owner's account for the team, the author for a PR the owner asked of someone outside), the type label of its title — `feat` `enhancement`, `fix` or `hotfix` `bug`, `docs` `docs`, `test` `test`, any other `chore` — and an `area:*` label for each area it touches. An issue the team opens gets the same: `gh issue create … --label <type>,status:accepted`, plus an `area:*` label for each area it touches, assigned to whoever will build it (`--assignee @me` when that is the team). 64 closed PRs had neither and were mended by hand on 22 November 2026.

## What the type of a commit decides

The title of a PR becomes the commit on `develop`, and semantic-release reads it to choose the next version ([`release-flow.md`](./release-flow.md)): `feat`, `fix`, `perf` and `hotfix` release, `chore`, `docs`, `ci`, `test` and `refactor` do not. A `fix` hidden under `chore` never reaches anyone.

## Work in parallel: numbers and issues

Several sessions work at once, each on its own branch, and each sees only `develop` as it was when it began.

- **An ADR takes the next number free on `origin/develop` and in every open PR**: `git fetch` and `ls docs/adr`, then `gh pr list --json number,files --jq '.[] | .number as $n | .files[].path | select(startswith("docs/adr/")) | "#\($n) \(.)"'`. Read it again before the merge: a PR merged meanwhile may have taken it. The gates refuse two records of one number (`npm run check:adr`, #183) — on a PR's head, which can be older than another PR's merge (`develop` does not ask a branch to be up to date), and again on the merged commit before it is released: #158 and #177 both took 0016, and git, seeing two file names, merged both.
- **A follow-up issue is searched for before it is opened**, open and closed: `gh issue list --state all --search "<its key words>"`. #151 and #176 were the same issue, opened by two sessions an hour apart. An issue the team opens carries its labels from the start: "A pull request", point 7.

## Repository settings

Set on GitHub: the repository is **public** (the owner, 20 November 2026, #28); default branch `develop`; squash merge and merge commit allowed, rebase merge off; head branches **not** deleted on merge.

- **Branch protection** of `main` and `develop` (the owner, #28): no deletion, no force-push, no push but the merge of a PR, and the PR's six checks green — `Format, lint, types, tests, build`, `Conventional title`, `Linked issue`, and, since their burn-in (the owner, 20 November 2026, #93), `Windows tests, build`, `E2E (Windows)`, `Installer smoke (Windows)`. Admins are held to it too. A check's name is its job's name in `gates.yml` or `pr-title.yml`: a job renamed there is a check nobody reports, which blocks every PR until the branch protection of both branches, and this list, are changed with it. A new job of the gates is added here only after its burn-in ([`testing.md`](./testing.md), "Burn-in").
- **Approval by the owner** (a ruleset of that name on `main` and `develop`; the owner, 20 November 2026, #76): one approving review required, dropped by a new push. Only the owner has write access, so only the owner's approval counts. GitHub does not let the author of a PR approve it, so the repository's admin role may bypass the review — when merging a PR, never on a push: **a PR the owner's account opens** (every PR of the team) is merged with `gh pr merge --admin`, on what the "Merging" table of [`review-flow.md`](./review-flow.md) says; **a PR anyone else opens** (a fork, Dependabot) waits for the owner's approving review, given by the owner's own hand. Who merges, and on whose word: the "Merging" table of [`review-flow.md`](./review-flow.md). The husky hooks stay: they refuse a direct commit before GitHub does.
- **Why head branches are not deleted on merge**: the back-merge of a release is a PR whose head is `main`. The protection refuses to delete `main` now, and the setting stays off all the same, so that neither depends on the other alone. A work branch is deleted by whoever merges it, at the merge (`git push origin --delete <branch>`, or the button on the PR) — never with a flag on the back-merge.
- **Actions**: the workflows of a PR from a fork wait for the owner's approval, for every outside contributor; the `GITHUB_TOKEN` reads only, and no workflow may approve a PR. How such a PR is reviewed: [`review-flow.md`](./review-flow.md), "A pull request from outside".
- **Security, and what a stranger sees** (the owner, 24 November 2026, #310, #190): private vulnerability reporting on — the one channel of [`SECURITY.md`](../../SECURITY.md), of [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md) and of the security link of the issue forms (`.github/ISSUE_TEMPLATE/config.yml`): turned off, all three lead nowhere; Dependabot alerts on, its security updates off. The topics (`alldebrid`, `debrid`, `download-manager`, `electron`, `hls`, `typescript`, `windows`, `yt-dlp`), the homepage set to the latest release, and the social preview, uploaded by hand from [`docs/design/social-preview.png`](../design/social-preview.png): GitHub has no API for it. No `good first issue` or `help wanted` label: the team opens every pull request (#221).
- **Who can write**: the owner alone. An outside contributor works on a fork and cannot push, merge or label here ([`CONTRIBUTING.md`](../../CONTRIBUTING.md)).

## The two PRs that have no issue

A release (`develop` → `main`) and its back-merge (`main` → `develop`) close no issue and have no `<type>/<issue>-…` branch: their heads are `develop` and `main` themselves. The rule on branch names and `Closes #N` does not apply to them. They are titled `release: vX.Y.Z` and `chore: merge main back into develop after vX.Y.Z`; how each is merged, and by whom, is the "Merging" table of [`review-flow.md`](./review-flow.md).

The `Linked issue` check lets those two through, and the PRs Dependabot opens (`.github/dependabot.yml`), which no person writes and which carry no issue either; each is still reviewed as the "Merging" table says.
