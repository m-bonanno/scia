# Review flow

Every pull request is reviewed by a team of senior roles before it is merged, with one exception named under "Merging". The reviews run locally, in Claude Code, each as an independent agent; their text is posted on the PR, so the history of why something was approved or sent back stays with the PR.

Run it with `/team-review <PR number>`.

## The team

| Role              | Reviews when                                                                                                                                                        | Definition                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Tech lead         | **always** — and owns `.github/`, `scripts/`, root tooling, `.claude/`, ADRs, runbooks                                                                              | `.claude/agents/tech-lead.md`         |
| Backend engineer  | the PR touches `packages/core`, `packages/contracts`, `apps/server`, `apps/desktop`                                                                                 | `.claude/agents/backend-engineer.md`  |
| Frontend engineer | the PR touches `apps/renderer`, `apps/extension`                                                                                                                    | `.claude/agents/frontend-engineer.md` |
| Product designer  | the PR touches anything a person sees or reads: `apps/renderer/src`, `apps/extension/static`, a string of the interface, `docs/design/`                             | `.claude/agents/product-designer.md`  |
| Product manager   | the PR releases something (its type in the table of [`release-flow.md`](./release-flow.md), or a release into `main`), or it touches `docs/product/` or `README.md` | `.claude/agents/product-manager.md`   |

### A small PR is the tech lead's alone

The owner's decision (#18): the review is complete where it is needed, not everywhere. A PR is **small** when it is one of:

- **documentation only** — every file it changes is Markdown, or is under `docs/` or `.claude/`;
- **a few lines** — at most 20 changed lines outside specs (`git diff --shortstat origin/develop...HEAD -- . ':!*.test.ts' ':!*.test.tsx'`, insertions plus deletions).

A small PR is reviewed by the tech lead alone, whatever the table above says: its triggers — an area, a type that releases, `docs/design/`, `docs/product/`, `README.md` — become what the tech lead weighs first for a call-in. The tech lead calls a role in when the change needs that eye: a string a person reads → the product designer; a principle, the vision or the state of the roadmap → the product manager; a change of behaviour in an area → its engineer.

The call-in is a line of its own at the top of the tech lead's review — `Call in: product manager — the roadmap's M1 line changes what "done" means` — and is repeated in its answer. The orchestrating session starts that role in the same round, before the verdict; the role reviews as in any other PR, and its verdict counts.

A release into `main` is never small.

## The gates

One list, for the author before opening the PR, for the tech lead in the first round of the review, for CI on GitHub. In a later round the tech lead reads CI's run on the new head instead of running the gates again (the owner, 21 November 2026, #187): "Rules", below. On a PR from a fork, CI's run is the only one: "A pull request from outside".

```bash
npm run gates
```

It runs `check:adr` (no two ADRs of one number: [`git-flow.md`](./git-flow.md), "Work in parallel"), `format:check`, `lint`, `typecheck`, `test` (with a reporter of dots) and `build`, in that order, and stops at the first that fails, naming it (`scripts/gates.mjs`). Its last line says what the run was, and CI writes it to the summary of its run, which the PR body links ([`testing.md`](./testing.md), "The gates' line"). Each can still be run alone while working. `SCIA_TEST_WORKERS=<n>` runs the tests on fewer workers: on the owner's machine the gates run with `SCIA_TEST_WORKERS=2`, one run at a time ([`git-flow.md`](./git-flow.md), "Work in parallel").

With untracked files of other work in the tree, check the format of tracked files only while working: `git ls-files | xargs npx prettier --check --ignore-unknown`; the run before the PR is made without them ([`testing.md`](./testing.md), "The gates' line").

A PR that touches the app's runtime — `apps/desktop`, `apps/server`, `apps/renderer`, `packages/` — is also held by the E2E suite, which runs in CI's `E2E (Windows)` job, not on the owner's machine: it starts Electron, whose windows take the screen ([`testing.md`](./testing.md), #218). Read that job on the PR.

CI runs them on Ubuntu, and all but the ADR numbers, format, lint and types again on Windows, the system Scia ships for, with the E2E suite on every PR; it runs them once more on the commit a merge makes, before that commit is released ([`testing.md`](./testing.md), "Where CI runs them"). A gate green here and red on one of CI's systems is red. "Quarantine (report only)" is not a gate ([ADR 0019](../adr/0019-specs-in-quarantine.md)): "CI is green" means every required check.

## What is blocking

This is the one definition; role files and `CLAUDE.md` point here. A finding is blocking when it is one of:

1. a rule of this repository broken (`CLAUDE.md`, a sub-`CLAUDE.md`, an ADR, a runbook, `.claude/gotchas.md`);
2. a bug;
3. a security hole;
4. a red gate;
5. a claim of proof in the PR body that is not true: something seen failing, what a spec holds, a run's or a sweep's result, a number measured;
6. a point of the linked issue neither delivered nor declared out of scope in the PR body.

Everything else is non-blocking: a suggestion, a question, something to track. Blocking is a fact, never a taste.

**Any other error of the PR body is mended, not reviewed again** (the owner, 26 November 2026, #373): a section of the template missing, a line of "How" the diff no longer matches, a rule about the body not followed. The role notes it ("What a review looks like"), the author mends the body before the verdict, and the verdict names what was mended; no round starts for it. The body reaches no history: the squash's is `Closes #N` ("Merging").

A red check on a spec the PR does not touch, with no cause in its diff, is not a round of review: it is handled as [`testing.md`](./testing.md), "No retries", says, and the verdict holds for the head once its required checks are green. #173 spent its third round on the speed limit's spec (#43).

## Rules

- **Independent.** A reviewer gets its role file, the PR and the issue it closes, never the author's reasoning: an agent handed a conclusion returns it confirmed. What the owner asked for belongs in the issue, where every reviewer reads it.
- **Read-only.** Reviewers do not edit, commit, push or comment. Each writes its review to a file outside the repository, in a folder of its own that the other roles are told not to read, and answers with its verdict; the orchestrating session posts the files as they are and applies the fixes. On a PR from a fork they run nothing of it either — no script, harness, install or gate: "A pull request from outside".
- **The team verdict is deterministic**: approved only if no role has a blocking finding, and it holds for one head commit.
- **Changes requested** → the fix lands on the same branch as new commits, never a force-push. Every round is posted, and the rounds after the first are lighter (the owner, 21 November 2026, #187):
  - **A fix that touches only specs or the PR body** is reviewed by the roles that blocked, each resumed so that it checks its own findings, and by no other.
  - **Any other fix**: the roles are decided again on the whole diff, size included (a fix can reach a new area, or make a small PR a large one); every role that blocked reviews again, resumed so that it checks its own findings; a role that had approved reviews again if the fix changes its area; a role the fix newly involves reviews for the first time.
  - **The gates**: the tech lead, when it reviews the round, reads CI's run on the new head — every required check, with its numbers — instead of running every gate again, as it already does on a fork's PR ("A pull request from outside"). CI green on the head is a condition of the merge in any round ("Merging").
- **Nothing unreviewed is merged.** A commit pushed after the approval — a non-blocking finding taken at the last moment — is reviewed before the merge. The roles are decided again on the whole diff, as after a fix, size included: a late commit can make a small PR a large one. Then the tech lead reviews it; so does every role of that set whose area the commit changes; and a role of that set that had not reviewed the PR yet reviews all of it. The verdict is posted again for the new head. None of this applies to a merge of `develop`: the next rule does.
- **A merge of `develop` into an approved branch keeps the verdict when it brings in only `develop`** (the owner, 26 November 2026, #374). Right after it, `npm run check:merge` (`scripts/merge-check.mjs`) compares the branch's own lines before and after the merge (`git diff -U0 … | git patch-id --stable`), and makes the merge again with `git merge-tree`, under the branch's attributes. The same lines, and the merge git makes by itself: the session posts the script's line on the PR and the verdict again for the merge commit, and CI on it decides — if the head the script names as the merge's first parent is the head the verdict holds for. Other lines, or a merge git would not make by itself — a conflict resolved by hand, a merge edited: the tech lead reads the merge commit (`git show --remerge-diff <merge>`), and the verdict is posted for it. On a PR from outside, the script runs from `develop`'s checkout on the merge's sha (`npm run check:merge -- <sha>`, after `git fetch origin pull/<N>/head`): nothing of the PR is run ("A pull request from outside").
- **A wording point raised after the approving verdict goes into a follow-up issue**, not into a commit after the approval (the owner, 24 November 2026, #337): such a commit is a round of its own, above. A finding that is blocking ("What is blocking") is not a wording point: it is fixed, and its commit reviewed.
- **Non-blocking findings are not lost**: taken in the same PR when they are in its scope and cheap, otherwise collected in a follow-up issue — searched for first, open and closed, as [`git-flow.md`](./git-flow.md) says ("Work in parallel") — opened before the approving verdict and linked from it. A verdict that asks for changes names none: its findings are still being fixed.
- **A blocking finding the author contests goes to the owner.** The orchestrating session never overrules a reviewer; it fixes, or it asks.
- **Every review teaches.** A blocking finding that a checklist would have prevented becomes a line under "Lessons" in that role's file, or an entry in `.claude/gotchas.md`, in the PR that fixes it.

## The team verdict

Posted at the end of every round, as its last comment — before the fixes of a new round as before a merge:

```markdown
## Team verdict

**Approved** | **Changes requested** — for `<head commit>`.

- Tech lead: approve (round 2)
- Backend: approve (round 1)
- …

Body mended: <what, in a few words>
Follow-ups: #N
```

`Body mended:` is left out when no role noted the body. The last line is `Follow-ups: none` when an approving verdict leaves nothing to track, and is left out of a verdict that asks for changes.

## Merging

| Pull request                                 | Merged when                                                                                                                                       | How                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A work branch into `develop`                 | the team approves its head and CI is green                                                                                                        | **squash**, the PR title becoming the commit |
| `develop` into `main` (a release)            | the team approves, CI is green, **and the owner says so**                                                                                         | **merge commit**, never a squash             |
| `main` back into `develop` (after a release) | CI is green. The one PR nobody of the team reviews: it carries only what was reviewed on its way into `main`. The orchestrating session merges it | **merge commit**, never a squash             |

`main` and `develop` are protected on GitHub ([`git-flow.md`](./git-flow.md), "Repository settings"): GitHub merges a PR only with its checks green and **the owner's approval** (the owner, 20 November 2026, #76). The team's PRs are opened from the owner's account, which cannot approve its own PR: they are merged with the admin bypass of that review (`gh pr merge --admin`), on what this table says — the team's verdict, CI, and for a release the owner's word. **A PR anyone else opens is merged only after the owner approves it on GitHub, by the owner's own hand**: the table's conditions, and then that approval.

The two merge commits are what lets semantic-release count the next version from the last one ([`release-flow.md`](./release-flow.md)): squashing either breaks the count.

**A squash is given its own body: `gh pr merge <n> --squash … --body "Closes #N"`.** Left to GitHub, the squash's body is the message of every commit of the branch, and semantic-release's notes list each issue that body names: "closes #99" six times in `v1.0.0-beta.30` (#249). The title is the PR's, and the body names the issue once — and, for a breaking change, carries the `BREAKING CHANGE:` footer too, which says what breaks: with a `!` in the title alone, the notes print only the title ([`release-flow.md`](./release-flow.md)) — and, for a revert, the line `This reverts commit <sha>.`, without which the preset reads no revert and releases nothing for it (`release-flow.md`). Nothing else goes there.

**After every merge into `develop` or `main`**, whoever merged reads that a Release run started for the merge commit, and starts one by hand when none has. GitHub once recorded no push for a merge, and nothing was released (#95). The steps are in [`release-flow.md`](./release-flow.md), "A merge nothing released".

## A pull request from outside

**The team opens every PR** (the owner, 22 November 2026, #221): a PR from a fork is closed, kindly, pointing to an issue (`CONTRIBUTING.md`, "Pull requests come from the team"), and nothing of it is run. What follows stays the rule for the one case the owner may still make: a PR from outside the owner asked for on an accepted issue.

- **An issue first.** The PR closes an issue that explains the problem or the feature, and the `Linked issue` check fails it otherwise. **The owner chooses by hand** which issues are taken up (`status:accepted`), and asks for a PR from outside on the issue itself; any other PR from outside is closed with a sentence on why.
- **CI waits for the owner.** Its workflows run only once the owner approves the run on the PR. Before approving it, the owner reads what the PR changes in `.github/`, `scripts/`, `.husky/`, the configs at the root and `package.json`/`package-lock.json`: those run on GitHub's runner.
- **Never run a contributor's code on the owner's machine outside a sandbox.** Not `npm ci` or `npm install` (install scripts), not a gate, a test, a build, `npm start` or a harness, not a checkout with the hooks on: husky runs a `.husky/post-checkout` the PR adds. **The gates come from CI**, on GitHub's runners: the tech lead reads that run, on the head under review, instead of running them, and reports its numbers. The reviewers read the diff — `gh pr diff <N>`, and after `git fetch origin pull/<N>/head`, `git show <sha>:<path>`; a tree to read whole files in is made with `git -c core.hooksPath=/dev/null worktree add --detach <dir> <sha>`, and nothing in it is run. Evidence of a real run is the contributor's, in the PR body; seeing it again takes a sandbox (Windows Sandbox, a throwaway virtual machine).
- **`/team-review <N>`** as for any PR, roles, rounds and verdict alike. The reviews are posted on the PR; **the team verdict is posted on the linked issue too**, with each blocking finding on a line of its own, so that whoever follows the issue sees what stands between it and a merge.
- **Changes requested** → the contributor fixes them on the same branch, as new commits, and the next round runs on the new head when the owner starts it. A PR whose findings stay unanswered is closed by the owner.
- **Approved, CI green** → **the owner approves it on GitHub, by their own hand** — a session never approves a PR from outside — and it is squash-merged like any work branch. Only the owner's account merges: a contributor cannot. A push after the owner's approval drops it. CodeQL's three required checks never run on a PR from a fork: the owner takes them off `develop`'s protection by hand for the merge, and puts them back right after ([`git-flow.md`](./git-flow.md), "Repository settings"; the owner, 25 November 2026, #332). Nothing else is merged into `develop` while they are off, and after the merge the session reads the protection back: nine contexts on `develop` (`gh api repos/<owner>/<repo>/branches/develop/protection/required_status_checks`).

## What a review looks like

Each role answers in this shape, posted on the PR under its own header (`## Tech lead review`, `## Backend review`, …):

```markdown
**Verdict: APPROVE** | **Verdict: CHANGES REQUESTED**

### Blocking

- `path/to/file.ts:42` — what is wrong, the rule or the failure it causes, what would fix it.

### Non-blocking

- Suggestions, questions, things to track in an issue.
- Body: an error of the PR body that is not a claim of proof, for the author to mend ("What is blocking").

### Checked

- What was read and run, with numbers where there are numbers.
```

"None." is a valid content for a section. A review with a blocking finding is `CHANGES REQUESTED`; without one it is `APPROVE`.

## When roles disagree

Two roles asking for opposite things is settled by the tech lead's synthesis: a rule of the repository beats an opinion, and inside an area its owner decides. What is not settled there goes to the owner as a question, not into the code as a compromise.
