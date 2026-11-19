# Review flow

Every pull request is reviewed by a team of senior roles before it is merged. The reviews run locally, in Claude Code, each as an independent agent; their text is posted on the PR, so the history of why something was approved or sent back stays with the PR.

Run it with `/review <PR number>`.

## The team

| Role              | Reviews when the PR touches                                                                               | Definition                            |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Tech lead         | **always** — and owns `.github/`, `scripts/`, root tooling, `.claude/`, ADRs, runbooks                    | `.claude/agents/tech-lead.md`         |
| Backend engineer  | `packages/core`, `packages/contracts`, `apps/server`, `apps/desktop`                                      | `.claude/agents/backend-engineer.md`  |
| Frontend engineer | `apps/renderer`, `apps/extension`                                                                         | `.claude/agents/frontend-engineer.md` |
| Product designer  | anything a person sees or reads: `apps/renderer/src`, `apps/extension/static`, UI strings, `docs/design/` | `.claude/agents/product-designer.md`  |
| Product manager   | every `feat` and `fix`; `docs/product/`, `README.md`                                                      | `.claude/agents/product-manager.md`   |

## Rules

- **Independent.** A reviewer gets its role file and the PR, never the author's reasoning: an agent handed a conclusion returns it confirmed.
- **Read-only.** Reviewers do not edit, commit, push or comment. Each writes its review to a file outside the repository and answers with its verdict; the orchestrating session posts the files as they are and applies the fixes.
- **Tests run locally.** The author runs every gate the diff touches before opening the PR; the tech lead runs all of them again during the review and reports the numbers. CI runs them a third time on GitHub.
- **Blocking is a fact, not a taste**: a broken rule of this repository, a bug, a security hole, a red gate, a claim in the PR body that is not true, a point of the issue not delivered and not declared out of scope.
- **The team verdict is deterministic**: approved only if no role has a blocking finding.
- **Changes requested** → the fix lands on the same branch as new commits; the roles that blocked review again, on the new commits and the updated body, and their second review is posted too. No force-push.
- **Non-blocking findings are not lost**: taken in the same PR when they are in its scope and cheap, otherwise collected in a follow-up issue linked from the team verdict.
- **Approved and CI green** → squash merge into `develop`, the PR title becoming the commit. The release workflow does the rest ([`release-flow.md`](./release-flow.md)).
- **`develop` → `main` is the owner's decision.** The team reviews a release PR like any other, but it is merged (a merge commit, never a squash) only on the owner's word.
- **Every review teaches.** A blocking finding that a checklist would have prevented becomes a line in that role's file or in `.claude/gotchas.md`, in the next PR at the latest.

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

## When there is a conflict

Two roles asking for opposite things is settled by the tech lead's synthesis: a rule of the repository beats an opinion, and inside an area its owner decides. What is not settled there goes to the owner as a question, not into the code as a compromise.
