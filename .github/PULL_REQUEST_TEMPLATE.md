<!--
  English only. Delete Notes / Out of scope if empty; never delete What / Why / How / References / Test plan.
  No AI attribution anywhere.
  Write the body to .claude/pr-bodies/<branch>.md and pass it with --body-file.
-->

## What

Closes #N. _One paragraph: what changes for whom._

## Why

_The problem or requirement (roadmap item, bug report). Cite the canon where it settles a choice._

## How

- _Surfaces touched, by layer: core / contracts / server / renderer / desktop / extension._
- _New ports, adapters, routes, bridge members, extension permissions — name them._
- _Docs updated: `docs/…` (or "none required: internal refactor")._

## Notes

_Edge cases, deliberate trade-offs, workarounds and why they are the pragmatic choice._

## Out of scope

_What this PR deliberately does not do._

## References

- Closes #N
- Related PRs / ADRs: _…_

## Test plan

- [ ] The gates, all of them (`docs/development/review-flow.md`) — green: _N tests passed_
- [ ] Real-runtime evidence _(shell, boot, quit, packaging)_: _what ran, what the log says_
- [ ] Keyboard-only path checked _(UI changes)_
- [ ] Both themes checked _(UI changes)_
- [ ] Manual smoke: _what to do → expected outcome_
