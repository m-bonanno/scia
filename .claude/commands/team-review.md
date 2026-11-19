---
description: Review a pull request with the team of roles, post each review on the PR, and merge it when the team approves.
---

Review PR `$ARGUMENTS` (default: the PR of the current branch) as `docs/development/review-flow.md` describes — that runbook is the rule, this is the order of the steps.

1. Check out the PR's branch; make sure it is pushed and the working tree is clean.
2. Decide the roles from the files the PR changes and from its type (the table in the runbook). The tech lead always reviews.
3. Start **one reviewer per role, in parallel, each with a fresh context**: give it its role file (`.claude/agents/<role>.md`), the PR number and the issue it closes — nothing of your own reasoning. Each writes its review to a file outside the repository (one per role and round) and answers with the verdict and its blocking findings only.
4. Post each file on the PR as a comment, under the role's header (`## Tech lead review`, `## Backend review`, …), exactly as written.
5. If two or more roles have findings, have the tech lead write the synthesis and post it.
6. If any role has a blocking finding: fix on the same branch (new commits, never a force-push), push, update the PR body, and run the next round as the runbook says. Post every round.
7. Open the follow-up issue for the non-blocking findings left, then post the `## Team verdict` comment: the verdict, the head commit it holds for, the follow-up issue.
8. When the team approves the head commit **and** CI is green on it, merge as the runbook says for that kind of PR. Never merge a PR into `main` without the owner's word.
9. After the merge: pull the base branch and delete the local branch.
