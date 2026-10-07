# Track A — Settlement & chain

**Owner:** teammate (AnInsaneJimJam). **Branch:** `track-a/settlement`. **Status log:** [STATUS-A.md](STATUS-A.md).
Read [README.md](README.md) and [SHARED-CONTRACT.md](SHARED-CONTRACT.md) first.

Track A owns everything that touches Cardano/Masumi, the worker/outbox, the quote economics, and the buyer runner. Track A does **not** write `orderNonce`, `evidence`, `verification`, or recipient data; it reads `verification` to trigger `submit_result`.

## Files Track A owns

`packages/settlement/**` (new), `apps/worker/**` (new; Track B adds only `apps/worker/jobs/verify_evidence.ts` + one registry line), `packages/procurement/outbox.ts`, `packages/procurement/commands/{fund_escrow,request_refund,authorize_refund,create_intent}.ts`, migrations `01xx_*.sql`, `infra/masumi/**` (new), `scripts/spike/**` (new), `examples/buyer-agent/**` (new), `fixtures/settlement.ts` (new), `docs/integration-manifest.md` (payment sections).

## Tasks in order

### A0 — Step 0 shared foundation (do first, merge first, keep small)
Exactly SHARED-CONTRACT §3: migrations directory, per-command handler map, widened contract types, outbox + worker skeleton. Behaviour of the 16 existing tests must not change. Regenerate `docs/generated/`. Merge to `mvp-integration` and tell Track B.
**Done when:** typecheck/contracts:check/test green; a dummy job kind round-trips through the worker in a test; Track B can add a command and a job by adding files only.

### A1 — Masumi node on Preprod
`infra/masumi/`: docker compose for the official Masumi Payment Service + its Postgres (pin image tags/commit), `infra/masumi/.env.example` with names only (`ADMIN_KEY`, `ENCRYPTION_KEY`, `BLOCKFROST_API_KEY_PREPROD`, wallet mnemonic vars per the official README). **Set `ADMIN_KEY` explicitly**; the README says the seed falls back to a public default when unset. Generate purchasing + selling wallets, fund with tADA (Cardano Preprod faucet), establish how to obtain tUSDM, register the filler as a Masumi agent. Record versions, asset ID/decimals, agent ID, wallet addresses (public only) in `docs/integration-manifest.md`.
**Done when:** a fresh teammate can start the node from the runbook and see funded wallets.

### A2 — Preprod lifecycle spike (the gate for everything below)
Scripts in `scripts/spike/` that drive the real node: (1) payment request → purchase/lock → submit result → wait unlock → collected; (2) lock → buyer refund request → seller authorize → refunded; (3) lock → no result → what actually happens at each deadline. Record tx hashes, datum/state transitions, fees (Masumi % and ADA), minimum deadline gaps, durations, which wallet signs each step, and whether the seller can submit a result without our app. Update SHARED-CONTRACT §6 mapping via the changelog.
**Done when:** redacted traces for all three paths are in `docs/integration-manifest.md`. If a path fails, write down why and tell Track B before building on it.

### A3 — SettlementAdapter
`packages/settlement/index.ts` interface (SHARED-CONTRACT §6), `masumi-native.ts` HTTP client (per-actor base URL + token from env), `fixtures/settlement.ts` `ScriptedSettlement` with injectable failures (timeout after submit, pending forever, rollback). No route names leak outside this package.

### A4 — Quote and funding
- Quote: currency `INR|SGD|USD`, `grossBaseUnits` grossed up for the measured fee, ADA subsidy line, expiry (`order.quote`).
- At claim, create escrow terms → `order.escrow`.
- `fund_escrow` command (buyer): checks deadlines/amount/asset against the quote, calls `fund`, records operation; `funding = PENDING`.
- `observe_funding` job: `observe()` + Blockfrost cross-check → `funding = CONFIRMED` only on matching confirmed lock; mismatch → `RECONCILING`. Replace `confirmFixtureFunding` in non-test paths (keep it for tests).

### A5 — Result, settlement, refunds
- `submit_result` job (triggered per SHARED-CONTRACT §7) → `settlement.state = RESULT_PENDING` → observed → `DISPUTE_WINDOW`.
- `observe_settlement` + `monitor_deadlines` jobs: `SETTLEMENT_PENDING` → `PAID` on confirmed collection; obligations with `safeActBy` in the control view.
- `request_refund` (buyer) and `authorize_refund` (filler) commands → `REFUND_PENDING` → `REFUNDED` on confirmed refund.

### A6 — Buyer reference runner
`examples/buyer-agent/`: start run from an intent + policy (per-order max, daily cap, merchant allowlist, asset/network), create intent, fund within policy without asking again, wait via worker state (no model polling), review evidence when asked (calls Track B's `review_evidence`), request refund before `safeActBy` when result is missing/rejected. Survives restart.

### A7 — Failure tests (with ScriptedSettlement + local Postgres)
Equivalents of docs/06: T05 (pending ≠ funded), T06 (wrong amount/asset/seller), T07 (late funding), T17 (result without PASS), T19 (cooperative refund), T21 (crash around submission), T22 (exact net), T31 (vanished filler). Live Preprod evidence for T26 goes in the manifest.

## What Track A needs from Track B
- `order.verification` with `resultHash` and verdict (SHARED-CONTRACT §4/§7).
- `orderNonce` at claim (for the human checkout; A does not use it).
- `review_evidence` command for the buyer runner to call.

## What Track B needs from Track A, and when
- **A0 merged** (unblocks B's shared-file work).
- `funding` field semantics (`CONFIRMED` only from the observer) — from A4.
- `ScriptedSettlement` — from A3, so B's end-to-end tests run without a node.
