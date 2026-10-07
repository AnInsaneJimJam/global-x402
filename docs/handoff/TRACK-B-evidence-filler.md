# Track B — Evidence & filler

**Owner:** Ishaan. **Branch:** `track-b/evidence`. **Status log:** [STATUS-B.md](STATUS-B.md).
Read [README.md](README.md) and [SHARED-CONTRACT.md](SHARED-CONTRACT.md) first, then [docs/03-proof-and-settlement.md](../03-proof-and-settlement.md).

Track B owns proof of order placement and everything the filler touches: nonce, private recipient/assignment, evidence upload, DKIM verification, manual review, the filler agent loop, and (stretch) dashboard + CRE. Track B does **not** write `funding`, `escrow`, `quote` or `settlement`, and never calls Masumi.

## What DKIM proof means here
Amazon signs every order-confirmation email with its domain key (DKIM, e.g. `d=amazon.in`) and publishes the public key in DNS. The filler orders from their own account with a per-order nonce in the recipient name (`Alice Doe GOB-7F3K`), downloads the original email (Gmail → Show original → Download), and uploads the `.eml`. The verifier checks the signature against the merchant's DNS key (authentic), the nonce (this assignment), item/quantity/total/currency (matches quote), the email time (after funding, before deadline), and merchant-order uniqueness (not reused). It proves Amazon confirmed the order, not payment capture or delivery — which matches the placement-only MVP predicate.

## Files Track B owns

`packages/verification/**` (new), `packages/merchants/**` (new), `packages/procurement/commands/{claim,register_purchase,submit_evidence,review_evidence}.ts`, migrations `02xx_*.sql`, `apps/worker/jobs/verify_evidence.ts`, API routes for assignment and evidence upload, `packages/agent-runtime/**` (filler runtime), `examples/filler-agent/**` (new), `fixtures/synthetic/**` (new), `scripts/check-eml.ts` (new, local only), `apps/web/**` (stretch), `workflows/verify-order/**` (stretch).

**B-safe before Step 0 merges:** only `packages/verification/**`, `packages/merchants/**`, `fixtures/synthetic/**`, `scripts/check-eml.ts` and new test files for them. Do not edit `packages/contracts`, `service.ts`, `schema.sql`, or `apps/api` until A0 lands.

## Tasks in order

### B0 — Real-email check (today, no code)
In Gmail open one past Amazon.in order confirmation → ⋮ → Show original. Note the `DKIM: PASS with domain …` line and which fields the body contains (order number, item, quantity, total, recipient name/address). Record domain + field list (no personal data) in STATUS-B.md.

### B1 — DKIM verifier (pure)
`packages/verification/`: parse the `.eml`, verify the DKIM signature (evaluate an existing library such as `mailauth` before adding it; do not hand-roll RSA/canonicalisation), require `d=` to be in the merchant's allowlist and the signature to cover From/Subject/Date and the body, then evaluate the criteria in SHARED-CONTRACT §6. Missing DNS key / network error → `INCONCLUSIVE`, never `PASS`. Output the criteria table and `evidenceHash = sha256(raw)`.
Tests: generate a throwaway RSA key in the test, sign synthetic emails, stub `resolveDkimKey`. Cases: valid; edited body; wrong domain; missing nonce; wrong total/currency; wrong quantity; dated before funding; key not found → INCONCLUSIVE.
`scripts/check-eml.ts <path>` runs the verifier on a real local `.eml` with real DNS and prints only the criteria table (no addresses). Real `.eml` files stay outside git.

### B2 — Merchant configs
`packages/merchants/amazon-in.ts`, later `amazon-sg.ts`: allowed DKIM domains, currency, extraction rules (order number, item lines, quantity, total, recipient name), shaped from B0's findings. Add `amazon-sg` only after one real Amazon.sg order exists.

### B3 — Nonce, private recipient, assignment route (after A0)
- `claim` handler sets `order.orderNonce` (`GOB-` + 4–6 unambiguous chars, unique).
- Migration `0200_recipients.sql`: `gob_recipients(ref pk, buyer_id, data jsonb)`; `create_intent` input stores private recipient (coordinate the one-line change with Track A, who owns `create_intent`).
- `GET /v1/orders/:id/assignment`: buyer or the assigned filler only; returns recipient with the nonce appended to the name, exact item/quantity/max charge — **only when `order.funding === 'CONFIRMED'`**. Otherwise 404/409 with reason.

### B4 — Evidence upload + submit
- `POST /v1/orders/:id/evidence-uploads` (assigned filler): accepts `message/rfc822` up to ~1 MB, stores under `EVIDENCE_DIR/<orderId>/<sha256>.eml` with 0600 perms, returns `evidenceId`.
- Extend `submit_evidence` to bind `evidenceId` + merchant order ID, set `order.evidence`, keep merchant-order uniqueness, and enqueue `verify_evidence` in the same transaction.

### B5 — `verify_evidence` job + manual review
- Worker job runs B1 with expected values from the order/quote/escrow funding time, writes `order.verification` incl. `resultHash`, and on `PASS` enqueues `submit_result` (SHARED-CONTRACT §7).
- `review_evidence` command (buyer only): `APPROVE` → `MANUAL_APPROVED` + enqueue `submit_result`; `REJECT` → `MANUAL_REJECTED` + `REQUEST_REFUND` obligation. Label `verifier.execution = MANUAL`.

### B6 — Filler agent loop (human-assisted checkout)
`examples/filler-agent/`: acquisition goal → `GET /v1/orders` → `rankOpportunities` (existing) → claim → wait for `funding = CONFIRMED` → fetch assignment → print exact human instructions (merchant, item, quantity, max total, address, name **with nonce**) → human places order and supplies merchant order ID + `.eml` path → register purchase / report `ORDERED` (existing runtime; add a `HumanAssistedCheckout` adapter so `environment` can be `LIVE`) → upload + submit evidence → wait for settlement. Explain the chosen offer. Survives restart (existing journal).

### B7 — Failure tests
Equivalents of docs/06: T09 (fake/edited receipt), T10 (wrong SKU/qty/cost/recipient/time), T11 (reused merchant order), T12 (DNS/key outage → INCONCLUSIVE), T24 (wrong wallet reads assignment/evidence; no arbitrary URLs), T25 (instructions inside email text treated as data), T55 (second purchase after ORDERED blocked).

### B8 — Stretch: dashboard
Minimal page rendering the control view (filler: available/claimed/funding/purchase/verifying/settlement; buyer: review queue). No business logic in the UI.

### B9 — Stretch: CRE simulation
`workflows/verify-order/` wrapping the same B1 function, fetching the DKIM key via HTTP DoH, run with the CRE CLI in local simulation; label `CRE_SIMULATION`. Follow `docs/research/cre-proof.md`.

## What Track B needs from Track A
- **A0 merged** before B3+.
- `funding = CONFIRMED` semantics and `escrow` funding time (A4) for expected values; until then use `confirmFixtureFunding` in tests.
- `ScriptedSettlement` (A3) for end-to-end tests without a node.
- `submit_result` job kind registered (A5) — B only enqueues it.

## What Track A needs from Track B
- `order.verification.resultHash` + verdict, `review_evidence` command, `orderNonce` at claim.
