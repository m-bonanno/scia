# Contributing to Scia

Thank you for wanting to help. Scia is kept small on purpose, and one person decides what goes in: read this before writing code, so that your work is not lost.

## An issue first

Every change starts as an issue. Open one with a template — **Bug** for something that does not work, **Proposal** for a feature or an improvement — and say what the problem is before how to solve it.

The owner reads the issues and chooses by hand which ones are taken up, and says so on the issue. Wait for that before you write code: a pull request for an issue nobody took up may wait, or be closed.

Do not paste private links, keys of a service or tokens in an issue: describe the kind of link instead.

## Then a pull request, linked to its issue

1. Fork the repository and cut a branch from `develop`, named `<type>/<issue>-<description>`: `fix/42-resume-after-sleep`, `feat/57-schedule-downloads`. The types are those of [`commitlint.config.js`](./commitlint.config.js).
2. Write the test first, then the code ([`CLAUDE.md`](./CLAUDE.md), "Test-Driven Development"). Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with a lower-case subject.
3. Run the gates before you open the PR:

   ```bash
   npm ci
   npm run format:check
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

4. Open the PR into `develop`. Its title is a conventional commit too; its body follows the template and says **`Closes #N`**, with the number of the issue. A PR that closes no issue fails the `Linked issue` check.

Everything is written in English: code, comments, commits, the PR. Changes that work around a site's access controls or a DRM are not taken ([`CLAUDE.md`](./CLAUDE.md), "Respect the hosts").

## What happens to your pull request

- **CI runs once the owner approves it.** The checks of a PR from a fork wait for that approval, every time.
- **The owner chooses which PRs are reviewed.** A PR taken up is reviewed by the project's review team, which reads the diff and CI's results ([`docs/development/review-flow.md`](./docs/development/review-flow.md)). The findings are posted on the PR, and the verdict on its issue too.
- **You fix what is blocking** with new commits on the same branch — no force-push — and the next round reviews the new head. A PR whose findings stay unanswered is closed.
- **Approved, with CI green, it is squash-merged into `develop`** by the owner; its title becomes the commit, and the next beta's notes name it.

You cannot merge, push to this repository or change its settings: nobody outside it can. What you can always do is answer on your PR and on its issue.

## Licence

Scia is released under the [MIT licence](./LICENSE). By opening a pull request you agree that your contribution is released under it too.
