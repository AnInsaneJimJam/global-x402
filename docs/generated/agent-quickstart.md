# Local control-contract quickstart

Generated from runtime command definitions. All payment/merchant/verifier layers are MOCK.
Live funding, wallet authentication, independent verification, native refunds and settlement are unavailable.

Inspect GET /v1/capabilities, then GET /v1/orders for redacted opportunities or authenticated GET /v1/work for owned orders.
Prepare a typed command with POST /v1/action-plans. Commit the returned planId with a stable operationId and Idempotency-Key through its named route.

- create_intent: BUYER; POST /v1/intents. Persist a fixture intent; no money moves.
- claim: FILLER; POST /v1/orders/:id/claims. Reserve one unfunded intent; no money moves.
- register_purchase: FILLER; POST /v1/orders/:id/purchase-attempts. Record an obligation before actor-local checkout; registration is not placement.
- submit_evidence: FILLER; POST /v1/orders/:id/evidence. Bind an uploaded order-confirmation email to the purchase and queue DKIM verification; acceptance is not proof.
- review_evidence: BUYER; POST /v1/orders/:id/evidence-reviews. Manually approve or reject evidence that did not pass automatic verification; approval allows the result to be submitted.

Inspect GET /v1/orders/:id/control before choosing the next action. After timeout, retrieve GET /v1/operations/:operationId and reconcile the same operation; do not mint a replacement ID.
An actor-local unknown or already ordered purchase blocks another checkout. Stopping the local run keeps reconciliation available.

The local reference runtime supports startRun, inspect, purchase, reconcile, stop and resume. It requires an existing claimed/funded fixture; it is not yet a complete autonomous buyer/filler agent.
Raw merchant credentials and keys never enter this API. Dev bearer authentication is for localhost testing only.
