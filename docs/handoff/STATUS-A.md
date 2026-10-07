# STATUS — Track A (Settlement & chain)

Update at the end of every session. Newest entry on top. Keep it short; link PRs/commits.

## Current

| Task | State | Notes / link |
|---|---|---|
| A0 Step 0 foundation | DONE / MERGED | [PR #1](https://github.com/AnInsaneJimJam/global-x402/pull/1), merge `22d6d7b`: numbered migrations, command handlers, v0.2 types, transactional outbox/worker; 18/18 tests pass. |
| A1 Masumi node | PARTIAL — SEEDED; FUNDING PENDING | [Draft PR #4](https://github.com/AnInsaneJimJam/global-x402/pull/4), commit `07ebb73`. [Runbook](../../infra/masumi/README.md): pinned node/tooling overlay healthy; native V2 Preprod source and two wallets seeded. Observed tUSDM registry decimals = 6. Funded balances and registration remain pending. |
| A2 Preprod lifecycle spike | NOT STARTED | Gate for A4–A5 |
| A3 SettlementAdapter | NOT STARTED | |
| A4 Quote + funding | NOT STARTED | |
| A5 Result/settlement/refunds | NOT STARTED | |
| A6 Buyer runner | NOT STARTED | |
| A7 Failure tests | NOT STARTED | |

## Blockers

- Founder configured the Preprod project key locally; secrets/phrases remain ignored and mode 0600. Official faucet rate-limited the funding attempt; founder is trying the Masumi dispenser, which needs a registration-email verification code.
- Still needed: observed tADA on both wallets and tUSDM on purchasing, scoped actor keys and confirmed filler registration. No native payment transaction or registration has been observed yet.
- Registration needs an actual test-service URL; the placeholder in the V2 template must not be published as a working capability.

## Interface change requests to Track B

- A0 adds transitional `Order.evidence: Evidence | string | null` so existing fixture behavior remains stable. Track B can replace the string path when B4 lands.
- Job handlers receive `(job, store)`; use `store.transaction()` for verification state + `enqueue()` in the same transaction. Track B owns its `verify_evidence` file and registry entry.

## Session log

- 2026-10-07 — A1 infrastructure built on `track-a/settlement`. Official 0.29.0 image digest/source revision pinned; missing upstream seed workspace files repaired with an exact-source tooling overlay, frozen offline dependency relinking, and direct Node startup. Native dependency preflight, migrations, local HTTP health, secret preservation and wallet initialization passed. After the founder configured the Preprod key, native V2 seeding succeeded; node wallet identities and tUSDM decimals were observed. Both balances remain empty; official faucet rate-limited the founder. Typecheck/contracts:check and 18/18 tests pass (Postgres tests required execution outside the process sandbox). Public addresses and source-versus-runtime evidence are in [the manifest](../integration-manifest.md). A2 not started; no shared interface changes.
- 2026-10-07 — A0 merged into `mvp-integration` in [PR #1](https://github.com/AnInsaneJimJam/global-x402/pull/1) (`22d6d7b`). Track B shared-file work is unblocked after rebasing onto integration. Typecheck, contracts:check, 18/18 tests green; A1 is next.
- 2026-10-07 — Handoff created. Baseline: typecheck, contracts:check, 16/16 tests green on `feature/agent-control-recovery` @ 27a4915.
