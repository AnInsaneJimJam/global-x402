# Acceptance tests and demo

Test business invariants and external boundaries. The implementation agent must discover actual commands from project configuration, record them and their observed results, and distinguish unit tests, local fixtures, CRE simulation and testnet transactions. This planning repository has not executed these application tests.

## Acceptance matrix

| ID | Scenario | Required result |
|---|---|---|
| T01 | Buyer exceeds budget, wrong merchant/network/asset, or expired quote | Agent refuses signing; order cannot become funded through that request |
| T02 | Two concurrent buyer orders approach daily cap | Atomic budget reservation prevents policy overspend |
| T03 | Two fillers claim simultaneously | Exactly one active assignment; loser receives conflict |
| T04 | Duplicate create/fund/evidence requests and process restart | Stable order/claim/tx identity; no duplicate purchase authorization or payout |
| T05 | Payment visible only in mempool / ambiguous HTTP timeout | No purchase authorization until configured confirmations |
| T06 | Wrong datum, seller, amount, token, network or order commitment | Funding rejected/quarantined; no private assignment exposure |
| T07 | Claim expires while payment is pending or a valid late tx lands | No unsafe reassignment; old liability reconciled/refunded |
| T08 | Ledger rollback after funding observation | Observer detects inconsistency; holds new actions and surfaces risk |
| T09 | Fake screenshot / edited receipt | Cannot independently pass proof predicate |
| T10 | Genuine merchant order has wrong SKU, quantity, cost, recipient, purchaser, time or canceled status | Deterministic failure reason; no automatic approval |
| T11 | Same merchant purchase reused for another order/filler | Unique binding prevents second payout |
| T12 | Merchant timeout, rate limit or incomplete response | INCONCLUSIVE and bounded retry/review, never PASS |
| T13 | Tampered, replayed, expired, wrong-workflow or wrong-environment CRE report | Rejected before lifecycle work |
| T14 | Duplicate signatures in report threshold verification | Cannot count the same signer twice |
| T15 | Simulation output sent to deployed-mode consumer | Rejected; test-only credentials cannot authorize live flow |
| T16 | Valid evidence | Exact bound result recorded; native actions honor signer authority and deadlines |
| T17 | Seller submits result outside app without valid proof | Buyer monitor observes it and exercises tested refund/dispute path in time |
| T18 | Buyer offline through dispute deadline | Exposed limitation documented; no false claim of indefinite protection |
| T19 | No purchase / cooperative refund | Actual applicable refund transition and confirmed return to buyer |
| T20 | Dispute / unavailable arbitrator / settlement window not reached | Honest pending status; app cannot force unsupported release |
| T21 | Worker crashes before/after transaction submission | Restart reconciles stable operation; no double effect |
| T22 | Successful collection | Token balance/transaction delivers exactly quoted net proceeds; all costs reconciled |
| T23 | Merchant cancels after payout | Incident recorded; no fictitious clawback or delivery guarantee |
| T24 | Unassigned wallet reads address/evidence; filler supplies arbitrary URL | Access denied; no SSRF/private-host request |
| T25 | Malicious instructions in receipt/product text | Treated as data; cannot change policy, destinations, secrets or tool authority |
| T26 | Real scheme/native adapter | Complete funding→result→collection and funding→refund tests against pinned deployment; mock tests insufficient |
| T27 | Filler asks its agent to acquire tokens | Agent compares supported offers, explains selection and respects fiat/net-reward/settlement-risk limits |
| T28 | Checkout returns timeout after merchant accepted purchase | Agent reconciles existing order before retrying; one merchant purchase |
| T29 | Merchant requires MFA/3DS or lacks authorized automation API | Explicit intervention/blocker; no bypass or false fully autonomous claim |
| T30 | Filler agent calls an offer the best deal | Comparison scope, fee basis and quote timestamps are visible; synthetic quotes labeled |
| T31 | Filler disappears after funding without submitting any result | Exercise actual no-result recovery path with required signers/deadlines; document whether cooperation/arbitration is needed, not just a cooperative refund test |
| T32 | Merchant refunds filler's card after token payout | Record distinct merchant refund and buyer reimbursement obligations; UI must not claim the buyer automatically received tokens back |

For T17, inability to enforce the merchant predicate on-chain is a material trust limitation even if the monitor works. Record the maximum monitored response delay and compare it with remaining native deadlines. Mainnet readiness is not inferred from one successful testnet run.

## Demo narrative

1. Show network, actual asset, escrow mode, merchant mode, CRE mode and payout condition on the first screen.
2. Buyer instructs the reference agent to buy the configured Coke SKU, quantity one, delivered to a synthetic address. Show agent budget enforcement and a fee-transparent quote.
3. Filler tells its agent to acquire tokens within a fiat budget. The agent compares available offers, explains the expected net benefit, claims a suitable order and waits for actual funding. Explain the selected match-before-lock sequence and direct filler escrow recipient.
4. Show the escrow transaction and fixed recipient. Filler proceeds only after confirmation.
5. Filler agent completes the selected familiar merchant/platform's authorized checkout and submits an order reference. Show independent merchant lookup and real CRE execution in the available mode. Label official sandbox purchases accurately; use a custom demo merchant only if that last-resort fallback was chosen.
6. Show predicate comparison and the bound result. Display native dispute/collection timing instead of claiming instantaneous release.
7. Show the final confirmed filler receipt and economics using a completed earlier run if necessary. Label prerecorded evidence with timestamps and keep its IDs separate from the live order.
8. Show one bad-proof rejection and a previously completed refund with its chain evidence.

Never accelerate on-chain deadlines by changing the UI clock. Local accelerated tests are labeled simulations. If x402 lifecycle fails and D7 selects native Masumi, state explicitly that x402 purchase funding remains incomplete.

## Required demo artifacts

- Integration manifest with network, actual asset identifiers, deployment/version hashes, observed fees, deadlines and confirmation policy.
- Redacted quote, order/claim/escrow IDs, transaction links for lock, result, payout and refund.
- CRE source, invocation instructions, execution output, report verification evidence and live/simulation label.
- Merchant fixture/API source and a description of who controls the data.
- End-to-end runbook, required environment variable names without values, and clean setup instructions.
- Test report listing actual commands and PASS/FAIL/BLOCKED evidence, plus unresolved limitations.

## Claims supported by the proposed demo

“An external agent can commission a purchase through an escrow-backed filler marketplace on Cardano, with a verified merchant API workflow and explicit settlement conditions.”

Only strengthen that claim to x402-funded escrow after G1/G3 pass. Only claim deployed Chainlink verification after actual DON execution and report validation. Do not claim universal Amazon verification, guaranteed physical delivery, zero trust, instant payouts, native USDC on Cardano, or guaranteed profit after fees.
