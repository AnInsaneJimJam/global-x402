# STATUS — Track B (Evidence & filler)

Update at the end of every session. Newest entry on top. Keep it short; link PRs/commits.

## Current

| Task | State | Notes / link |
|---|---|---|
| B0 Real-email check (Amazon.in) | WAITING ON ISHAAN | Download one Amazon.in confirmation (Gmail → Show original → Download original), run `node --import tsx scripts/check-eml.ts <file.eml>`, paste the JSON (it has no personal data) below. Keep the .eml outside the repo |
| B1 DKIM verifier | DONE | `packages/verification/{index,doh}.ts`, 8 tests in `tests/verification.test.ts` (synthetic emails, test-generated key). `mailauth@7.1.1` + `mailparser@3.9.36` (MIT, pinned) |
| B2 Merchant configs | PARTIAL | `MerchantConfig` + `toMinor` in `packages/merchants/index.ts`; `amazon-in.ts` waits for B0 findings |
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

- 2026-10-07 — B1 verifier landed on `track-b/evidence`. Decisions inside: only allowlisted merchant domains are ever looked up in DNS; signature must cover From/Date/Subject; any `l=` body-length limit is rejected (mailauth reports such signatures as `pass`, so the guard is ours); missing key / DNS failure → INCONCLUSIVE. Full suite 24/24, typecheck and contracts:check green. No shared files touched (Step 0 not yet merged).

- 2026-10-07 — Handoff created. Baseline: typecheck, contracts:check, 16/16 tests green on `feature/agent-control-recovery` @ 27a4915.
