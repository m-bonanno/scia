# Gotchas — tooling

For a change to `scripts/`, `.github/`, `.husky/`, `package.json` and its lock, or the root's configs, and for a merge or a release. Read with the general entries of [`.claude/gotchas.md`](../gotchas.md); each entry's story is in the issues it names.

- → `npm install` can leave `node_modules/electron/dist` empty while exiting 0 (`electron.exe` missing): run `node node_modules/electron/install.js`.
- → Husky runs whatever hook a checked-out tree carries (`core.hooksPath` is `.husky/_`), so checking out a contributor's branch runs their hook on this machine (#28). Read a fork's PR with `gh pr diff` and `git show`, or in a tree made with `git -c core.hooksPath=/dev/null worktree add`.
- → A branch is deleted once the merge is read back (`gh pr view <n> --json state`), not after the merge command: `gh pr merge --match-head-commit` refused a short SHA, and the `git push --delete` chained after it closed the PR it had not merged (#74).
- → A squash merge left to GitHub writes every commit of the branch into its body, and semantic-release's notes then repeat each issue it names (#249). Merge with `--body "Closes #N"`, plus the `BREAKING CHANGE:` footer or `This reverts commit <sha>.` where they apply, the one place semantic-release reads them (`release-flow.md`, #114); notes already published are mended by their text, never their tag.
- → A release rule of `.releaserc.json` hides commit-analyzer's default rules, the breaking one among them, from every commit it matches: `hotfix!:` made a patch (#366, #251). A type given a rule of its own is tried with `!` and with the footer, and the breaking rule sits beside it in `.releaserc.json`.
- → Git Bash says an exit code modulo 256: 1638 read as 102 (#172). A spec reads the code from Node (`execFile`'s `error.code`), a person from PowerShell (`(Start-Process … -Wait -PassThru).ExitCode`).
- → A step added to a reusable workflow runs in every caller: an artifact of one name, uploaded by each run of a burn-in's matrix, is refused from the second run on (#244). Read who calls the workflow (`burn-in.yml`, `release.yml`) before adding an upload, a cache key or a concurrency group.
