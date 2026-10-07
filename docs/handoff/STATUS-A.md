# STATUS — Track A (Settlement & chain)

Update at the end of every session. Newest entry on top. Keep it short; link PRs/commits.

## Current

| Task | State | Notes / link |
|---|---|---|
| A0 Step 0 foundation | DONE | Numbered migrations, command handlers, v0.2 types, transactional outbox/worker; 18/18 tests pass. |
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

## Session log

- 2026-10-07 — A0 implemented on `track-a/settlement`: typecheck, contracts:check, 18/18 tests green. Merge into `mvp-integration` is the next gate before A1 or Track B shared-file work.
- 2026-10-07 — Handoff created. Baseline: typecheck, contracts:check, 16/16 tests green on `feature/agent-control-recovery` @ 27a4915.
