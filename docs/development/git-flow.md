# Git flow

`main` ← `develop` ← `<type>/<issue>-<kebab-description>`.

- `main` is what was released. `develop` is the default branch, where work lands.
- A branch is cut from `develop` for one issue: `feat/12-tray-icon`, `fix/31-resume-after-sleep`. Types are those of `commitlint.config.js`.
- **Nobody commits or pushes to `main` or `develop`.** `.husky/pre-commit` and `.husky/pre-push` refuse it (`protected-branch-guard.sh`). Automation that legitimately must sets `HUSKY=0`.
- Commits follow Conventional Commits with a lower-case subject; `.husky/commit-msg` runs commitlint.
- When `develop` moves ahead, merge it into the branch. No rebase of pushed work, no force-push.
- A PR into `develop` is **squash-merged**, its title becoming the commit. `develop` → `main` is a **merge commit**, so `main` keeps every change that went into a release.

## A pull request

1. Title: `type(scope): description`, lower-case.
2. Body from `.github/PULL_REQUEST_TEMPLATE.md`, in English, written to `.claude/pr-bodies/<branch>.md` and passed with `gh pr create --body-file`.
3. `Closes #N` in the body.
4. Green `PR Quality Gates` before merging. Locally: `npm run format:check && npm run lint && npm run typecheck && npm test`.
5. No AI attribution anywhere.

## What the type of a commit decides

The title of a PR becomes the commit on `develop`, and semantic-release reads it to choose the next version ([`release-flow.md`](./release-flow.md)): `feat` and `fix` release, `chore`, `docs`, `ci`, `test` and `refactor` do not. A `fix` hidden under `chore` never reaches anyone.

## Repository settings

Set once, on GitHub: default branch `develop`; squash merge and merge commit allowed, rebase merge off; head branches deleted on merge. Branch protection is refused on a private Free repository: until the repository is public or on a paid plan, the hooks are the protection.
