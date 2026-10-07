# STATUS — Track A (Settlement & chain)

Update at the end of every session. Newest entry on top. Keep it short; link PRs/commits.

## Current

| Task | State | Notes / link |
|---|---|---|
| A0 Step 0 foundation | DONE / MERGED | [PR #1](https://github.com/AnInsaneJimJam/global-x402/pull/1), merge `22d6d7b`: numbered migrations, command handlers, v0.2 types, transactional outbox/worker; 18/18 tests pass. |
| A1 Masumi node | NOT STARTED | Needs `.env` values from founder |
| A2 Preprod lifecycle spike | NOT STARTED | Gate for A4–A5 |
| A3 SettlementAdapter | NOT STARTED | |
| A4 Quote + funding | NOT STARTED | |
| A5 Result/settlement/refunds | NOT STARTED | |
| A6 Buyer runner | NOT STARTED | |
| A7 Failure tests | NOT STARTED | |

## Blockers

- A1 live Preprod setup needs the founder to put node credentials and wallet seed values in ignored `infra/masumi/.env` locally; none are available yet.

## Interface change requests to Track B

- A0 adds transitional `Order.evidence: Evidence | string | null` so existing fixture behavior remains stable. Track B can replace the string path when B4 lands.
- Job handlers receive `(job, store)`; use `store.transaction()` for verification state + `enqueue()` in the same transaction. Track B owns its `verify_evidence` file and registry entry.

## Session log

- 2026-10-07 — A0 merged into `mvp-integration` in [PR #1](https://github.com/AnInsaneJimJam/global-x402/pull/1) (`22d6d7b`). Track B shared-file work is unblocked after rebasing onto integration. Typecheck, contracts:check, 18/18 tests green; A1 is next.
- 2026-10-07 — Handoff created. Baseline: typecheck, contracts:check, 16/16 tests green on `feature/agent-control-recovery` @ 27a4915.
