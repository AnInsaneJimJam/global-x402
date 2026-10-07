# STATUS — Track B (Evidence & filler)

Update at the end of every session. Newest entry on top. Keep it short; link PRs/commits.

## Current

| Task | State | Notes / link |
|---|---|---|
| B0 Real-email check (Amazon.in) | NOT STARTED | Record DKIM domain + fields present (no personal data) |
| B1 DKIM verifier | NOT STARTED | B-safe before Step 0 |
| B2 Merchant configs | NOT STARTED | B-safe before Step 0 |
| B3 Nonce + recipient + assignment | NOT STARTED | Needs A0 |
| B4 Evidence upload + submit | NOT STARTED | Needs A0 |
| B5 verify_evidence job + manual review | NOT STARTED | Needs A0 worker |
| B6 Filler agent loop | NOT STARTED | |
| B7 Failure tests | NOT STARTED | |
| B8 Dashboard (stretch) | NOT STARTED | |
| B9 CRE simulation (stretch) | NOT STARTED | |

## B0 findings

- DKIM domain: _(fill in)_
- Fields present in body: _(fill in)_

## Blockers

- None recorded yet.

## Interface change requests to Track A

- None.

## Session log

- 2026-10-07 — Handoff created. Baseline: typecheck, contracts:check, 16/16 tests green on `feature/agent-control-recovery` @ 27a4915.
