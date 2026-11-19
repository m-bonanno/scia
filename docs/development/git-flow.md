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
3. `Closes #N` in the body.
4. Before opening it, run the gates locally: the list is in [`review-flow.md`](./review-flow.md#the-gates).
5. The team reviews it. When it is merged, how, and on whose word depends on the kind of PR: the "Merging" table of [`review-flow.md`](./review-flow.md).
6. No AI attribution anywhere.

## What the type of a commit decides

The title of a PR becomes the commit on `develop`, and semantic-release reads it to choose the next version ([`release-flow.md`](./release-flow.md)): `feat` and `fix` release, `chore`, `docs`, `ci`, `test` and `refactor` do not. A `fix` hidden under `chore` never reaches anyone.

## Repository settings

Set once, on GitHub: default branch `develop`; squash merge and merge commit allowed, rebase merge off; head branches **not** deleted on merge.

- **Why not deleted**: the back-merge of a release is a PR whose head is `main`, and a repository that deletes head branches would delete `main` with it. A work branch is deleted by whoever merges it, at the merge (`git push origin --delete <branch>`, or the button on the PR) — never with a flag on the back-merge.
- **Branch protection** is refused on a private Free repository: until the repository is public, the hooks are the protection. The owner's decision (#18, and #28 for when and for what protected means): **the repository becomes public shortly before the first stable release, and `main` and `develop` are protected then** — no deletion, no force-push, only the merge of a PR with the two CI checks green and an approved review recorded on GitHub (the owner's words, #28). The owner is the only human account: from that day every PR waits for the owner's approval on GitHub, and the team's verdict alone merges nothing. Deletion on merge is off until then; whether it goes back on, once `main` cannot be deleted, is decided in the PR that records the protection.

## The two PRs that have no issue

A release (`develop` → `main`) and its back-merge (`main` → `develop`) close no issue and have no `<type>/<issue>-…` branch: their heads are `develop` and `main` themselves. The rule on branch names and `Closes #N` does not apply to them. They are titled `release: vX.Y.Z` and `chore: merge main back into develop after vX.Y.Z`; how each is merged, and by whom, is the "Merging" table of [`review-flow.md`](./review-flow.md).
