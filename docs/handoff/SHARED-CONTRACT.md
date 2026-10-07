# Shared contract between Track A and Track B

This is the only document both tracks build against. Code that crosses the boundary must match it. Change it only through the changelog at the bottom (see README merge protocol).

## 1. Decisions in force (7 October 2026)

| Topic | Decision | Consequence |
|---|---|---|
| Architecture | A: intent → filler claim → buyer funds escrow naming that filler → filler buys → verified **order placement** → native settlement | Unchanged from docs 00–07 |
| Checkout | Filler places the order **manually from their own merchant account** to the buyer's delivery address | `merchant.checkout = HUMAN_ASSISTED`; no merchant API |
| Proof | **DKIM-signed order-confirmation email** (raw `.eml` upload). Order bound by a per-order **nonce** placed in the recipient name (e.g. `Alice Doe GOB-7F3K`). Anything not passing goes to **manual review** | Track B builds verifier + review; Track A consumes the verdict |
| Merchant | Merchant-agnostic verifier + per-merchant config. **Amazon.in first** (real emails exist), **Amazon.sg** added once an SG account and one real order exist. Demo merchant chosen later | Currency becomes `INR \| SGD \| USD` |
| Payment | **Native Masumi (MIP-003)**, not x402. D7 resolved. Never label funding as x402 | `payment.protocol = MASUMI_NATIVE` |
| Masumi node | **One shared self-hosted node** on Preprod holding the buyer purchasing wallet and filler selling wallet(s). Labeled operator-held test wallets. Per-actor config so it can be split into two nodes by changing `.env` only | Masumi-hosted service rejected: KYC, unknown price, no purchase/refund routes documented |
| Verifier location | Our worker first (`APP_WORKER_DKIM`); the same pure function wrapped in a CRE workflow later (`CRE_SIMULATION`, stretch) | — |
| Fees | Quote grossed up so filler net survives the measured Masumi fee; ADA costs shown as operator subsidy | Track A measures in A2 |

## 2. IntegrationIdentity v0.2 (replaces the v0.1 literals)

```ts
payment:  { protocol: 'MASUMI_NATIVE', network: 'cardano:preprod', execution: 'LIVE' | 'MOCK',
            custody: 'OPERATOR_HELD_TEST_WALLETS' }
merchant: { id: 'amazon-in' | 'amazon-sg' | 'fixture-merchant', environment: 'LIVE' | 'MOCK',
            checkout: 'HUMAN_ASSISTED' | 'AUTOMATED' }
verifier: { execution: 'APP_WORKER_DKIM' | 'MANUAL' | 'CRE_SIMULATION' | 'MOCK' }
```

Display labels are derived from these values, never stored separately. Tests and fixtures keep `MOCK`.

## 3. Step 0 — shared foundation (Track A owns, merged before anything else touches shared files)

Small, no business logic. Goal: after Step 0, the two tracks add **new files** instead of editing the same lines.

1. **Migrations directory.** Move `packages/procurement/schema.sql` to `packages/procurement/migrations/0000_base.sql`. `Store.migrate()` applies every `migrations/*.sql` in filename order (all statements stay `IF NOT EXISTS`, so re-running is safe). Number ranges: Track A `01xx_*.sql`, Track B `02xx_*.sql`.
2. **Command handler map.** Split the `eligible()`/`act()` switch in `packages/procurement/service.ts` into `packages/procurement/commands/<command>.ts`, each exporting `{ role, path, eligible(actor, order, input), apply(db, actor, order, command) }`, registered in `commands/index.ts`. Behaviour and existing tests unchanged. New commands = new file + one registry line.
3. **Widen contract types once** in `packages/contracts/index.ts`: IntegrationIdentity v0.2 (§2); intent `currency: 'INR' | 'SGD' | 'USD'`; `assetId` a validated string from config instead of the fixture literal; `Order` gets the optional fields in §4 (typed, `null` by default); control-view enums widened to the full sets in §5. Regenerate `docs/generated/`.
4. **Outbox + worker skeleton.** Migration `0100_outbox.sql`: `gob_outbox(id text pk, kind text, order_id text, dedupe_key text unique, payload jsonb, attempts int, next_at timestamptz, lease_until timestamptz, last_error text)`. `apps/worker/main.ts` leases due jobs (`FOR UPDATE SKIP LOCKED`), dispatches by `kind` through `apps/worker/jobs/index.ts`, retries with capped backoff. Job handlers live in `apps/worker/jobs/<kind>.ts`. `enqueue(db, {kind, orderId, dedupeKey, payload})` helper in `packages/procurement/outbox.ts`, always called inside the same transaction as the state change.
5. **.gitignore**: already updated in the handoff commit for `.DS_Store`, `.evidence/`, and `*.eml` outside `fixtures/synthetic/`.

## 4. Order fields and who writes them

All live in the existing `gob_orders.data` JSON document. Writer = the only track whose code assigns the field; the other track only reads.

| Field | Type (summary) | Writer | Read by |
|---|---|---|---|
| `intent.currency`, `intent.fiatMinor` | existing, currency widened | A (quote) | both |
| `quote` | `{ fiatMinor, rewardMinor, grossBaseUnits, netBaseUnits, protocolFeeBaseUnits, adaSubsidyLovelace, expiresAt }` | A | B (filler ranking/UI) |
| `orderNonce` | `string` like `GOB-7F3K`, set at claim | B | filler UI |
| `escrow` | `{ escrowId, sellerAgentId, buyerWalletRef, assetId, grossBaseUnits, deadlines: { payBy, submitResultBy, unlockAt, externalDisputeUnlockAt }, nativeState, lastObservedAt }` | A | B (deadlines in UI) |
| `funding` | existing `'NOT_OBSERVED' \| 'CONFIRMED'` (+ `'PENDING'`, `'RECONCILING'`) | A (chain observer only) | B gates assignment on `CONFIRMED` |
| `purchase` | existing | B (filler runtime, human-assisted) | both |
| `evidence` | `{ evidenceId, sha256, sizeBytes, merchantOrderId, submittedAt }` (replaces the v0.1 string) | B | — |
| `verification` | `{ verdict: 'PASS'\|'FAIL'\|'INCONCLUSIVE', execution, reviewedBy?, criteria[], reasonCodes[], evidenceHash, resultHash, observedAt }` | B | **A: triggers `submit_result` on PASS or manual approve** |
| `settlement` | `{ state: 'NONE'\|'RESULT_PENDING'\|'DISPUTE_WINDOW'\|'SETTLEMENT_PENDING'\|'PAID'\|'REFUND_PENDING'\|'REFUNDED'\|'DISPUTED', txs: {kind, txHash, status}[] }` | A | B (UI) |

Private recipient data is **not** in `gob_orders`. Track B adds a `gob_recipients` table (migration `02xx`) keyed by `recipientRef`, readable only by the buyer and the funded assigned filler.

## 5. Control-view vocabulary (Step 0 widens to these sets)

- Fact keys: `funding`, `escrow`, `merchantPurchase`, `evidence`, `verification`, `settlement`.
- Fact `sourceType`: `MASUMI_NODE`, `CHAIN_OBSERVER`, `ACTOR_REPORT`, `DKIM_EMAIL`, `MANUAL_REVIEW`, `MOCK_CHAIN`.
- Obligations: `FUND_ESCROW`, `PLACE_ORDER`, `RECONCILE_PURCHASE`, `SUBMIT_EVIDENCE`, `VERIFY_EVIDENCE`, `REVIEW_EVIDENCE`, `SUBMIT_RESULT`, `MONITOR_DISPUTE_WINDOW`, `REQUEST_REFUND`, `AUTHORIZE_REFUND`, `COLLECT`.
- Actions/commands: existing four + `fund_escrow` (A), `review_evidence` (B), `request_refund` (A), `authorize_refund` (A).
- `outcome.verification`: `NOT_STARTED | PENDING | PASS | FAIL | INCONCLUSIVE | MANUAL_APPROVED | MANUAL_REJECTED`. `outcome.settlement`: the `settlement.state` values.

Each track fills in only the facts/obligations/actions its own fields produce.

## 6. Interfaces

### SettlementAdapter (Track A implements; domain terms, not Masumi route names)

```ts
// packages/settlement/index.ts
export interface SettlementAdapter {
  readonly identity: { protocol: 'MASUMI_NATIVE'; network: 'cardano:preprod'; execution: 'LIVE' | 'MOCK' };
  createEscrowTerms(i: { orderId: string; termsHash: string; sellerAgentId: string; assetId: string;
    grossBaseUnits: string }): Promise<{ escrowId: string; deadlines: Deadlines }>;
  fund(i: { escrowId: string; buyerWalletRef: string; operationId: string }): Promise<{ status: 'PENDING' | 'OUTCOME_UNKNOWN'; txHash?: string }>;
  observe(escrowId: string): Promise<{ nativeState: string; funded: boolean; confirmations: number; txs: { kind: string; txHash: string }[]; observedAt: string }>;
  submitResult(i: { escrowId: string; resultHash: string; operationId: string }): Promise<{ status: 'PENDING' | 'OUTCOME_UNKNOWN'; txHash?: string }>;
  requestRefund(i: { escrowId: string; operationId: string }): Promise<{ status: 'PENDING' | 'OUTCOME_UNKNOWN'; txHash?: string }>;
  authorizeRefund(i: { escrowId: string; operationId: string }): Promise<{ status: 'PENDING' | 'OUTCOME_UNKNOWN'; txHash?: string }>;
}
```

`MasumiNativeAdapter` (live) and `ScriptedSettlement` (tests) both implement it. **Provisional Masumi mapping, unverified until Track A's Preprod spike (A2):** `createEscrowTerms` → seller-side payment request; `fund` → buyer-side purchase; `submitResult` → seller submit-result; `requestRefund` → buyer request-refund; `authorizeRefund` → seller authorize-refund. A2 records the real routes/payloads and updates this section via the changelog.

### Verifier (Track B implements; pure, no DB, no signing authority)

```ts
// packages/verification/index.ts
export function verifyOrderEmail(i: {
  raw: Uint8Array;                         // original .eml bytes
  expected: { orderId: string; claimId: string; termsHash: string; nonce: string; merchantId: string;
              itemMatch: string; quantity: number; totalMinor: string; currency: string;
              fundedAt: string; purchaseDeadline: string };
  merchant: MerchantConfig;                // packages/merchants/<id>.ts
  resolveDkimKey: (domain: string, selector: string) => Promise<string | null>;  // DNS-over-HTTPS in prod, stub in tests
  now: Date;
}): Promise<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; criteria: { id: string; expected: string; observed: string | null;
  result: 'PASS' | 'FAIL' | 'UNKNOWN' }[]; reasonCodes: string[]; merchantOrderId: string | null;
  evidenceHash: string; dkimDomain: string | null; observedAt: string }>;
```

`resultHash` (what Track A writes on-chain) = `hash({ orderId, claimId, termsHash, evidenceHash, verdict, criteria })` using the existing `hash()` in `packages/contracts`. Track B computes and stores it in `order.verification.resultHash`.

## 7. The hand-over point between tracks

1. Track B's `submit_evidence` handler stores the `.eml`, sets `order.evidence`, and enqueues job `verify_evidence` (dedupe key `verify:<orderId>:<sha256>`).
2. Track B's `apps/worker/jobs/verify_evidence.ts` runs the verifier and sets `order.verification`.
   - `PASS` → in the **same transaction** enqueue `submit_result` (dedupe `result:<orderId>:<resultHash>`).
   - `FAIL`/`INCONCLUSIVE` → obligation `REVIEW_EVIDENCE` (owner: buyer). Track B's `review_evidence` command (buyer only) sets `MANUAL_APPROVED` → enqueue `submit_result`; or `MANUAL_REJECTED` → obligation `REQUEST_REFUND` (owner: buyer runner, Track A).
3. Track A's `apps/worker/jobs/submit_result.ts` calls `SettlementAdapter.submitResult(order.verification.resultHash)` and owns everything after it (dispute window, collection, refund).
4. Assignment reveal: Track B's `GET /v1/orders/:id/assignment` returns recipient + nonce **only when `order.funding === 'CONFIRMED'`** (field written only by Track A's observer).

Job kinds: Track A owns `observe_funding`, `submit_result`, `observe_settlement`, `monitor_deadlines`. Track B owns `verify_evidence`.

## 8. Environment variable names (values only in ignored `.env`)

| Name | Owner | Meaning |
|---|---|---|
| `DATABASE_URL`, `PORT`, `DEV_BUYER_TOKEN`, `DEV_FILLER_TOKEN` | existing | — |
| `BUYER_MASUMI_URL`, `BUYER_MASUMI_TOKEN` | A | Buyer-side node API (same node for now) |
| `FILLER_MASUMI_URL`, `FILLER_MASUMI_TOKEN` | A | Seller-side node API (same node for now) |
| `FILLER_AGENT_IDENTIFIER` | A | Registered Masumi agent ID for the demo filler |
| `ESCROW_ASSET_ID`, `ESCROW_ASSET_DECIMALS` | A | e.g. Preprod tUSDM `policyId.assetNameHex` from chain data |
| `BLOCKFROST_API_KEY_PREPROD` | A | Independent chain cross-check |
| `EVIDENCE_DIR` | B | Private local evidence storage (default `.evidence/`, git-ignored) |
| `DKIM_DOH_URL` | B | DNS-over-HTTPS endpoint for DKIM keys |
| `MERCHANTS_ENABLED` | B | e.g. `amazon-in,amazon-sg` |

The Masumi node's own secrets (`ADMIN_KEY`, `ENCRYPTION_KEY`, its Blockfrost key, wallet mnemonics) stay in `infra/masumi/.env`, never in the app `.env`.

## 9. Provisional end-to-end flow (baseline; Track A's spike may revise steps 3–4 and 9–11)

1. Buyer agent `create_intent` → quote (A).
2. Filler agent ranks opportunities and `claim`s → nonce issued (B).
3. Payment request created on the filler/seller side → escrow ID + deadlines stored (A).
4. Buyer agent `fund_escrow` within policy → lock tx (A).
5. Observer confirms lock → `funding = CONFIRMED` (A).
6. Filler sees address + nonce via assignment route; human orders on Amazon from own account (B).
7. Filler registers purchase / reports `ORDERED` with merchant order ID (existing code, B).
8. Filler uploads `.eml` → `submit_evidence` → `verify_evidence` (B).
9. PASS or manual approve → `submit_result` (A).
10. Dispute window observed → collection → `PAID` (A).
11. No result / rejected → buyer `request_refund` → filler `authorize_refund` or dispute → `REFUNDED` (A).

## Changelog

| Date | By | Change |
|---|---|---|
| 2026-10-07 | Handoff | Initial contract. Masumi route mapping provisional pending A2. |
| 2026-10-07 | Track A | A0 foundation adds the v0.2 contract fields and vocabulary. Existing MOCK `NOT_IMPLEMENTED` outcomes and string evidence remain transitional until Track B replaces the fixture evidence path. |
