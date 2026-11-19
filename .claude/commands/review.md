---
description: Review a pull request with the team of roles, post each review on the PR, and merge it when the team approves.
---

Review PR `$ARGUMENTS` (default: the PR of the current branch) as `docs/development/review-flow.md` describes. In short:

1. Check out the PR's branch; make sure it is pushed and the working tree is clean.
2. Decide the roles from the files the PR changes (the table in the runbook). The tech lead always reviews.
3. Start **one reviewer per role, in parallel, each with a fresh context**: give it its role file (`.claude/agents/<role>.md`), the PR number, what the owner asked for where the PR body cannot say it, and nothing of your own reasoning. Reviewers are read-only: they do not edit, commit or comment. Each writes its review to a file outside the repository (one per role and round) and answers with the verdict and its blocking findings only.
4. Post each file on the PR as a comment, under the role's header (`## Tech lead review`, `## Backend review`, …), exactly as written.
5. If two or more roles have findings, have the tech lead write the synthesis and post it.
6. **Team verdict**: approved only if no role has a blocking finding. Otherwise fix on the same branch (new commits, never a force-push), push, update the PR body, and have the roles that blocked review again — the same agents, resumed, so they check their own findings. Post the second round and a `## Team verdict` comment.
7. When the team approves **and** CI is green: squash-merge into `develop` with the PR title as the commit. A PR into `main` is never merged here without the owner's word.
8. After the merge: pull `develop`, delete the local branch, open a follow-up issue for the non-blocking findings left, and for every blocking finding a checklist would have prevented, add a line under "Lessons" in that role's file or an entry in `.claude/gotchas.md`, in the next PR at the latest.
