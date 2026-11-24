<!--
  A PR closes an issue: open one first (CONTRIBUTING.md). The Linked issue check fails a body that closes none.
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

- [ ] The gates, all of them (`docs/development/review-flow.md`) — green: _the last line `npm run gates` printed, pasted as it is_
- [ ] E2E specs _(shell, boot, quit, a download in the real app)_: _which spec holds it, seen failing with its line taken away_
- [ ] Real-runtime evidence _(what the E2E suite cannot reach: what the system draws, packaging, a long run)_: _what ran, what the log says_
- [ ] Keyboard-only path checked _(UI changes)_
- [ ] Light and dark variants checked, in the default theme _(UI changes; every theme when a token or a pairing of tokens changes)_
- [ ] Manual smoke: _what to do → expected outcome_
