# Review flow

Every pull request is reviewed by a team of senior roles before it is merged, with one exception named under "Merging". The reviews run locally, in Claude Code, each as an independent agent; their text is posted on the PR, so the history of why something was approved or sent back stays with the PR.

Run it with `/team-review <PR number>`.

## The team

| Role              | Reviews when                                                                                                                                          | Definition                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Tech lead         | **always** — and owns `.github/`, `scripts/`, root tooling, `.claude/`, ADRs, runbooks                                                                | `.claude/agents/tech-lead.md`         |
| Backend engineer  | the PR touches `packages/core`, `packages/contracts`, `apps/server`, `apps/desktop`                                                                   | `.claude/agents/backend-engineer.md`  |
| Frontend engineer | the PR touches `apps/renderer`, `apps/extension`                                                                                                      | `.claude/agents/frontend-engineer.md` |
| Product designer  | the PR touches anything a person sees or reads: `apps/renderer/src`, `apps/extension/static`, a string of the interface, `docs/design/`               | `.claude/agents/product-designer.md`  |
| Product manager   | the PR releases something (`feat`, `fix`, `perf`, `hotfix`, any breaking change, a release into `main`), or it touches `docs/product/` or `README.md` | `.claude/agents/product-manager.md`   |

### A small PR is the tech lead's alone

The owner's decision (#18): the review is complete where it is needed, not everywhere. A PR is **small** when it is one of:

- **documentation only** — every file it changes is Markdown, or is under `docs/` or `.claude/`;
- **a few lines** — at most 20 changed lines outside specs (`git diff --shortstat origin/develop...HEAD -- . ':!*.test.ts' ':!*.test.tsx'`, insertions plus deletions).

A small PR is reviewed by the tech lead alone, whatever the table above says: its triggers — an area, a type that releases, `docs/design/`, `docs/product/`, `README.md` — become what the tech lead weighs first for a call-in. The tech lead calls a role in when the change needs that eye: a string a person reads → the product designer; a principle, the vision or the state of the roadmap → the product manager; a change of behaviour in an area → its engineer.

The call-in is a line of its own at the top of the tech lead's review — `Call in: product manager — the roadmap's M1 line changes what "done" means` — and is repeated in its answer. The orchestrating session starts that role in the same round, before the verdict; the role reviews as in any other PR, and its verdict counts.

A release into `main` is never small.

## The gates

One list, for the author before opening the PR, for the tech lead during the review, for CI on GitHub:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

With untracked files of other work in the tree, check the format of tracked files only: `git ls-files | xargs npx prettier --check --ignore-unknown`.

## What is blocking

This is the one definition; role files and `CLAUDE.md` point here. A finding is blocking when it is one of:

1. a rule of this repository broken (`CLAUDE.md`, a sub-`CLAUDE.md`, an ADR, a runbook, `.claude/gotchas.md`);
2. a bug;
3. a security hole;
4. a red gate;
5. a claim in the PR body that is not true;
6. a point of the linked issue neither delivered nor declared out of scope in the PR body.

Everything else is non-blocking: a suggestion, a question, something to track. Blocking is a fact, never a taste.

## Rules

- **Independent.** A reviewer gets its role file, the PR and the issue it closes, never the author's reasoning: an agent handed a conclusion returns it confirmed. What the owner asked for belongs in the issue, where every reviewer reads it.
- **Read-only.** Reviewers do not edit, commit, push or comment. Each writes its review to a file outside the repository, in a folder of its own that the other roles are told not to read, and answers with its verdict; the orchestrating session posts the files as they are and applies the fixes.
- **The team verdict is deterministic**: approved only if no role has a blocking finding, and it holds for one head commit.
- **Changes requested** → the fix lands on the same branch as new commits, never a force-push. Then: the roles are decided again on the whole diff, size included (a fix can reach a new area, or make a small PR a large one); every role that blocked reviews again, resumed so that it checks its own findings; a role that had approved reviews again if the fix changes its area; a role the fix newly involves reviews for the first time; and the tech lead runs the gates again on the new head. Every round is posted.
- **Nothing unreviewed is merged.** A commit pushed after the approval — a non-blocking finding taken at the last moment — is reviewed before the merge. The roles are decided again on the whole diff, as after a fix, size included: a late commit can make a small PR a large one. Then the tech lead reviews it; so does every role of that set whose area the commit changes; and a role of that set that had not reviewed the PR yet reviews all of it. The verdict is posted again for the new head.
- **Non-blocking findings are not lost**: taken in the same PR when they are in its scope and cheap, otherwise collected in a follow-up issue, opened before the approving verdict and linked from it. A verdict that asks for changes names none: its findings are still being fixed.
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

Follow-ups: #N
```

The last line is `Follow-ups: none` when an approving verdict leaves nothing to track, and is left out of a verdict that asks for changes.

## Merging

| Pull request                                 | Merged when                                                                                                                                       | How                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A work branch into `develop`                 | the team approves its head and CI is green                                                                                                        | **squash**, the PR title becoming the commit |
| `develop` into `main` (a release)            | the team approves, CI is green, **and the owner says so**                                                                                         | **merge commit**, never a squash             |
| `main` back into `develop` (after a release) | CI is green. The one PR nobody of the team reviews: it carries only what was reviewed on its way into `main`. The orchestrating session merges it | **merge commit**, never a squash             |

`main` and `develop` are protected on GitHub ([`git-flow.md`](./git-flow.md), "Repository settings"): GitHub merges a PR only with its checks green, and **requires no approving review** — it does not let the author of a PR approve it, and the team's PRs are opened from the owner's account (the owner, 20 November 2026, #28). What this table says is what merges: the team's verdict, CI, and for a release the owner's word.

The two merge commits are what lets semantic-release count the next version from the last one ([`release-flow.md`](./release-flow.md)): squashing either breaks the count.

## A pull request from outside

A PR from a fork, by someone without write access. The flow for its author is [`CONTRIBUTING.md`](../../CONTRIBUTING.md); this is the team's side of it.

- **An issue first.** The PR closes an issue that explains the problem or the feature, and the `Linked issue` check fails it otherwise. **The owner chooses by hand** which issues and which PRs are taken up; a PR nobody took up waits, or is closed with a sentence on why.
- **CI waits for the owner.** Its workflows run only once the owner approves the run on the PR. Before approving it, the owner reads what the PR changes in `.github/`, `scripts/`, `.husky/`, the configs at the root and `package.json`/`package-lock.json`: those run on GitHub's runner.
- **Never run a contributor's code on the owner's machine outside a sandbox.** Not `npm ci` or `npm install` (install scripts), not a gate, a test, a build, `npm start` or a harness, not a checkout with the hooks on: husky runs a `.husky/post-checkout` the PR adds. **The gates come from CI**, on GitHub's runners: the tech lead reads that run, on the head under review, instead of running them, and reports its numbers. The reviewers read the diff — `gh pr diff <N>`, and after `git fetch origin pull/<N>/head`, `git show <sha>:<path>`; a tree to read whole files in is made with `git -c core.hooksPath=/dev/null worktree add --detach <dir> <sha>`, and nothing in it is run. Evidence of a real run is the contributor's, in the PR body; seeing it again takes a sandbox (Windows Sandbox, a throwaway virtual machine).
- **`/team-review <N>`** as for any PR, roles, rounds and verdict alike. The reviews are posted on the PR; **the team verdict is posted on the linked issue too**, with each blocking finding on a line of its own, so that whoever follows the issue sees what stands between it and a merge.
- **Changes requested** → the contributor fixes them on the same branch, as new commits, and the next round runs on the new head when the owner starts it. A PR whose findings stay unanswered is closed by the owner.
- **Approved, CI green** → squash-merged like any work branch. Only the owner's account merges: a contributor cannot.

## What a review looks like

Each role answers in this shape, posted on the PR under its own header (`## Tech lead review`, `## Backend review`, …):

```markdown
**Verdict: APPROVE** | **Verdict: CHANGES REQUESTED**

### Blocking

- `path/to/file.ts:42` — what is wrong, the rule or the failure it causes, what would fix it.

### Non-blocking

- Suggestions, questions, things to track in an issue.

### Checked

- What was read and run, with numbers where there are numbers.
```

"None." is a valid content for a section. A review with a blocking finding is `CHANGES REQUESTED`; without one it is `APPROVE`.

## When roles disagree

Two roles asking for opposite things is settled by the tech lead's synthesis: a rule of the repository beats an opinion, and inside an area its owner decides. What is not settled there goes to the owner as a question, not into the code as a compromise.
