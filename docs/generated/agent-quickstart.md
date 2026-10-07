# Local control-contract quickstart

Generated from runtime command definitions. Payment is MOCK until a live Masumi adapter exists. Merchant/verifier labels are per order: amazon-in orders are LIVE, HUMAN_ASSISTED checkout, APP_WORKER_DKIM verification (MANUAL after buyer review); fixture orders are MOCK.
Live funding, wallet authentication, native refunds and settlement are unavailable. A live DKIM PASS on a fresh merchant email is not yet demonstrated.

Inspect GET /v1/capabilities, then GET /v1/orders for redacted opportunities or authenticated GET /v1/work for owned orders.
Prepare a typed command with POST /v1/action-plans. Commit the returned planId with a stable operationId and Idempotency-Key through its named route.

- create_intent: BUYER; POST /v1/intents. Persist a fixture intent; no money moves.
- claim: FILLER; POST /v1/orders/:id/claims. Reserve one unfunded intent; no money moves.
- register_purchase: FILLER; POST /v1/orders/:id/purchase-attempts. Record an obligation before actor-local checkout; registration is not placement.
- submit_evidence: FILLER; POST /v1/orders/:id/evidence. Bind an uploaded order-confirmation email to the purchase and queue DKIM verification; acceptance is not proof.
- fund_escrow: BUYER; POST /v1/orders/:id/funding. Lock the quoted escrow amount to the claimed filler via the Masumi node; pending until observed on chain.
- request_refund: BUYER; POST /v1/orders/:id/refund-requests. Ask the escrow for a refund before the result deadline; the filler may authorize it or it becomes a dispute.
- authorize_refund: FILLER; POST /v1/orders/:id/refund-authorizations. Filler agrees to return a requested refund to the buyer.
- review_evidence: BUYER; POST /v1/orders/:id/evidence-reviews. Manually approve or reject evidence that did not pass automatic verification; approval allows the result to be submitted.

Inspect GET /v1/orders/:id/control before choosing the next action. After timeout, retrieve GET /v1/operations/:operationId and reconcile the same operation; do not mint a replacement ID.
An actor-local unknown or already ordered purchase blocks another checkout. Stopping the local run keeps reconciliation available.

The reference filler agent (npm run filler) ranks, claims, waits for funding, hands checkout to the human, uploads the .eml and waits for the verdict; the buyer agent is not built yet.
Raw merchant credentials and keys never enter this API. Dev bearer authentication is for localhost testing only.
