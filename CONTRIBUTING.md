# Contributing to Scia

Thank you for wanting to help. Scia is kept small on purpose, and one person decides what goes in: read this before writing code, so that your work is not lost.

Everyone here follows the [code of conduct](./CODE_OF_CONDUCT.md). A security problem is never an issue: report it privately, as [`SECURITY.md`](./SECURITY.md) says.

## Ways to help without code

The help Scia needs most is not code:

- **Try a beta and say what you saw.** Much of Scia is held by tests and still to be seen by a person, against real services and sites, and nothing of it on Linux ([`docs/product/evidence.md`](./docs/product/evidence.md)). Your run is the evidence it lacks: open a [**Beta report**](https://github.com/m-bonanno/scia/issues/new?template=beta.yml).
- **Report a bug**, with what you saw and how to see it again.
- **Propose a feature**, starting from what you need rather than how to build it.
- **Say which site or service Scia should reach**, with a proposal: what it is, and what you would do with it.

## An issue first

Every change starts as an issue. Open one with a form, and say what the problem is before how to solve it:

- [**Bug**](https://github.com/m-bonanno/scia/issues/new?template=bug.yml): something that does not work. For an example, see [#205](https://github.com/m-bonanno/scia/issues/205): what was seen, in which version, and what is likely behind it.
- [**Proposal**](https://github.com/m-bonanno/scia/issues/new?template=feature.yml): a feature or an improvement. For an example, see [#215](https://github.com/m-bonanno/scia/issues/215): the need first, then what to settle and when it is done.
- [**Beta report**](https://github.com/m-bonanno/scia/issues/new?template=beta.yml): what you tried in a beta, and what you saw, whether it worked or not.

[All the forms](https://github.com/m-bonanno/scia/issues/new/choose).

The owner reads every issue and decides which ones are taken up, with its status label (below).

Do not paste private links, keys of a service or tokens in an issue: describe the kind of link instead.

## What happens to your issue

Every issue carries a status:

| Label               | Means                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| `status:triage`     | New: the owner has not read it yet. The forms add it.                              |
| `status:needs-info` | The owner needs an answer from you: a version, the steps, the kind of link.        |
| `status:accepted`   | The owner takes it up. The team will build it, and the issue says when it is done. |
| `status:declined`   | Not taken, with the reason on the issue, which is closed.                          |

## Pull requests come from the team

The team opens every pull request, for an issue the owner accepted, and reviews it as [`docs/development/review-flow.md`](./docs/development/review-flow.md) says. A pull request from outside the team is closed, kindly, pointing to an issue: open one, or add what you know to the one that exists. Your help counts as an issue: a clear report or a well-argued proposal is what moves Scia.

## If the owner asks you for a pull request

The owner may ask someone outside the team for a pull request, on an accepted issue, and says so on the issue. Then:

1. Fork the repository and cut a branch from `develop`, named `<type>/<issue>-<description>`: `fix/42-resume-after-sleep`, `feat/57-schedule-downloads`. The types are those of [`commitlint.config.js`](./commitlint.config.js).
2. Write the test first, then the code ([`CLAUDE.md`](./CLAUDE.md), "Test-Driven Development"). Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with a lower-case subject.
3. Run the gates before you open the PR:

   ```bash
   npm ci
   npm run gates
   ```

   It runs the ADR numbers check, format check, lint, typecheck, tests and build, and stops at the first that fails.

4. Open the PR into `develop`. Its title is a conventional commit too; its body follows the template and says **`Closes #N`**, with the number of the issue. A PR that closes no issue fails the `Linked issue` check.

Everything is written in English: code, comments, commits, the PR. Changes that work around a site's access controls or a DRM are not taken ([`CLAUDE.md`](./CLAUDE.md), "Respect the hosts").

The team reviews it as [`docs/development/review-flow.md`](./docs/development/review-flow.md) says. Nothing of it runs on the owner's machine: its checks run in CI once the owner approves them. You fix what is blocking with new commits on the same branch, never a force-push.

## Licence

Scia is released under the [MIT licence](./LICENSE). What the team builds from your issue is released under it too, and so is a pull request you open: by opening one you agree to that.
