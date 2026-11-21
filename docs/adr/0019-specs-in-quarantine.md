# ADR 0019 — Specs in quarantine run in a job of their own, which reports and never blocks

- **Status**: accepted
- **Date**: 2026-11-21
- **Amends**: [ADR 0008](./0008-the-delivery-pipeline.md), on what a quarantine is and on a red job being a red gate

## Context

ADR 0008 says a flaky spec is fixed, or quarantined — "skipped with the issue's number beside it" — and that from its first run a red job is a red gate. In practice a skipped spec was invisible: nobody could tell whether it still failed, so a skip was rarely chosen. Runs were started again until they passed instead (44904643296, 44919901657), against the "no retries" rule, and #173 spent a round of review on a spec it did not touch (#43).

The audit of 21 November 2026 asked for a quarantine that is seen (#186).

## Decision

1. **A spec in quarantine is a spec whose name ends with `[flaky #N]`**, `N` its issue. The gates and `npm test` pass it over: the `unit`, `integration` and `feature` projects of `vitest.config.ts` carry a `testNamePattern` that leaves it out. The renderer's specs and the E2E suite are not quarantined: a flaky one is fixed or skipped as ADR 0008 says.
2. **It still runs on every PR**, in the job "Quarantine (report only)", on Ubuntu and Windows (`npm run test:quarantine`). The job runs on pull requests only, not in a release's gates or a burn-in.
3. **That job is not a gate.** It is not a required check, it never blocks a merge or a release, and its red is news for the spec's issue. "A red job is a red gate" (ADR 0008) holds for every other job. "CI is green" before a merge means every required check.
4. **A spec leaves the quarantine only with its fix**, in the PR that closes its issue, after `npm run test:quarantine` and the job are read green.
5. **A quarantine is still a debt**: the roadmap does not count a quarantined spec as holding what it tests, and says so beside the line it would hold.

## Consequences

- A red check on a spec a PR does not touch is filed and quarantined, not a round of review (`review-flow.md`, "What is blocking"; `testing.md`, "No retries").
- While a spec is in quarantine its promise has no blocking check. The quarantine job shows whether it still fails; its issue carries the fix.
- A failing quarantine job shows as a red check on the PR. It is told apart by its name.
