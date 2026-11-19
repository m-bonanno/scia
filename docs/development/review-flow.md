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
- **Read-only.** Reviewers do not edit, commit, push or comment. Each writes its review to a file outside the repository and answers with its verdict; the orchestrating session posts the files as they are and applies the fixes.
- **The team verdict is deterministic**: approved only if no role has a blocking finding, and it holds for one head commit.
- **Changes requested** → the fix lands on the same branch as new commits, never a force-push. Then: the roles are decided again on the whole diff (a fix can reach a new area); every role that blocked reviews again, resumed so that it checks its own findings; a role that had approved reviews again if the fix changes its area; a role the fix newly involves reviews for the first time; and the tech lead runs the gates again on the new head. Every round is posted.
- **Nothing unreviewed is merged.** A commit pushed after the approval — a non-blocking finding taken at the last moment — is reviewed before the merge by the tech lead and by every role whose area it changes, and the verdict is posted again for the new head.
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

## Merging

| Pull request                                 | Merged when                                                                                                                           | How                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A work branch into `develop`                 | the team approves its head and CI is green                                                                                            | **squash**, the PR title becoming the commit |
| `develop` into `main` (a release)            | the team approves, CI is green, **and the owner says so**                                                                             | **merge commit**, never a squash             |
| `main` back into `develop` (after a release) | CI is green. The one PR nobody reviews: it carries only what was reviewed on its way into `main`. The orchestrating session merges it | **merge commit**, never a squash             |

The two merge commits are what lets semantic-release count the next version from the last one ([`release-flow.md`](./release-flow.md)): squashing either breaks the count.

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
