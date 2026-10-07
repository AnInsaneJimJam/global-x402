# Proof, CRE, and settlement policy

## What is being proved?

The user-confirmed MVP condition is **verified order placement**. The merchant must independently report a real accepted order for the assigned item, quantity and delivery recipient, at the authorized cost, with a valid merchant-defined payment arrangement. A cart, checkout session, unpaid draft or screenshot is insufficient. The merchant spike must map actual acceptance/payment states and identify whether payment is authorized, captured or collected later; never label authorization as capture. If no reliable accepted-order evidence is available, that merchant adapter fails G4 rather than weakening verification silently.

**Delivery failures after payout are outside MVP protection, as explicitly accepted by the user.** An order that is already canceled, failed or mismatched when verification occurs does not pass. Delivery verification remains a later product extension. Passing placement verification allows the native settlement lifecycle to proceed; it does not bypass its waiting periods.

This condition does not prove dispatch, delivery, item quality, irrevocable card settlement, or absence of a later cancellation/refund/chargeback. Even a genuine purchase can be canceled after escrow payout. If the buyer expects those protections, choose delivery-based or staged settlement and revise the contract and proof model.

## Evidence levels

| Evidence | Permitted use |
|---|---|
| Filler screenshot, PDF, uploaded receipt, copied email | Review aid; never sufficient for automatic payout |
| LLM/OCR extraction | Extract candidate fields; untrusted input, no signing or release authority |
| Merchant authenticated order API | Automatic predicate input if account authorization, field semantics and provenance are validated |
| Signed merchant attestation or validated webhook | Eligible only with key verification, freshness, replay protection and independent binding to the assignment |
| Authenticated browser/TLS attestation | Later research; requires a concrete reviewed verifier and account/recipient bindings, not a generic “zkTLS” placeholder |
| Controlled demo merchant API | Valid demonstration of orchestration; openly controlled source, not proof of Amazon integration |

Amazon's seller-facing Orders API cannot simply verify any consumer purchase. Authorized Amazon Business reporting may be relevant for a business account with the proper access, but availability of the required payment/address facts must be tested. See [CRE and merchant research](research/cre-proof.md). No scraping, merchant credential collection or inbox access is assumed in this specification.

The user's merchant preference is authoritative: evaluate familiar platforms and authorized evidence sources first, including official sandbox environments for testing. Build a custom demo merchant only if those paths are not viable and that fallback is explicitly chosen. Evidence access and automated checkout must both be demonstrated; availability of one does not establish the other. See [merchant options](research/merchant-options.md).

## Proposed verification predicate

Automatic `PASS` requires all of the following:

1. Order and funded claim are active, and evidence policy/version equals the one the buyer accepted.
2. Observation comes from the configured authenticated merchant adapter, not a filler-supplied URL. The merchant order ID is bound to this assignment and has not funded another payout.
3. Merchant account/purchaser binding corresponds to the assigned filler or an explicitly verified delegated account. An order number alone is not sufficient proof that the filler bought it.
4. Exact SKU/variant, quantity and landed amount/currency match the accepted quote. No silent substitutions, partial payments or gift-card assumptions.
5. Merchant-observed delivery recipient commitment equals the one in the funded assignment. The verifier computes it from merchant data with the private per-order commitment secret; the filler cannot supply both expected and observed address hashes.
6. Purchase time follows confirmed funding and is before the purchase deadline. Reject reused old orders.
7. Merchant status and payment status satisfy the versioned predicate, and cancellation/refund flags are absent at observation time.
8. Evidence is recent enough under policy, has consistent source timestamps, and is not contradicted by newer observations.

Normalize fields with versioned rules. Hash JSON using a documented canonicalization scheme (for example JCS) and a domain separator. Never rely on loose LLM semantic matches for item, money or recipient. Retain the restricted evidence needed to explain the result during the dispute window.

Return `PASS`, `FAIL`, or `INCONCLUSIVE` plus machine-readable reasons. Missing data, source outage, HTTP throttling, disagreement or stale evidence is `INCONCLUSIVE`, not approval and not proof of fraud. Retry within the remaining deadlines with bounded backoff. If insufficient time remains, enter review/refund handling according to available signer authority.

## CRE workflow

1. Authenticated trigger identifies `orderId`, `claimId`, `evidenceId`, `policyVersion` and a fresh `requestNonce`.
2. Workflow retrieves immutable expected terms through an authenticated read-only endpoint. In MVP the operator is trusted to serve these correctly; committing their hash in the funded request exposes later substitution. Read the funded commitment independently when the integration supports it.
3. Workflow fetches merchant observations using an allowlisted configured endpoint and scoped credential. Use supported confidential HTTP/secrets features when validated; do not assume all ordinary HTTP execution hides data from operators.
4. Normalize and evaluate the deterministic predicate. Consensus can establish agreement about retrieved data; it cannot establish truth beyond the source.
5. Emit a verification result containing all binding fields below. In deployed mode use the documented CRE report flow; local simulation is explicitly a separate trust mode.
6. Backend authenticates the report and checks the pending request, binding fields, expiry and evidence uniqueness. It persists the report before enqueueing lifecycle work.
7. Authorized participants/driver execute only the allowed Masumi transitions. Observer reconciles their result on Cardano.

Proposed result fields: `schemaVersion`, `environment`, `workflowId`, `policyVersion`, `orderId`, `claimId`, `escrowId`, `chain`, `assetId`, `termsHash`, `sellerIdentity`, `payoutAddress`, `grossAmountBaseUnits`, `expectedNetBaseUnits`, `merchantId`, `merchantOrderCommitment`, `evidenceHash`, `predicate`, `verdict`, `reasonCodes[]`, `observedAt`, `validUntil`, `requestNonce`.

These are application payload fields, not invented CRE SDK method arguments. Implement the envelope with the current documented SDK and verify canonical encoding in both producer and consumer.

## Report authentication and Cardano relay

Current researched CRE capabilities cover EVM and Solana; direct Cardano write capability was not established. Use an explicit adapter with named signing authority and trust boundaries. Documented off-chain CRE report verification can be used where the actual deployed report is available: validate report context, authorized DON signatures/threshold from the applicable registry, workflow identity/owner and metadata. Do not accept a JSON object because it contains `verified: true`.

Local simulation cannot satisfy production DON signature verification. Use separate credentials, configuration and accepted networks for simulated results, and fail closed if a production consumer receives simulation output. If deployed access is unavailable, demonstrate a real local CRE execution and label it `LOCAL SIMULATION`.

Do not implement homemade signature aggregation. Pin a documented verifier or reference implementation and test tampering, unknown signer/workflow, wrong environment, stale report and replay. Preserve the raw envelope for audit while restricting sensitive fields.

Neither a verified CRE report nor an HTTPS callback proves that the Cardano validator enforces that report. G3 determines whether the adapter is a trusted operator, a seller action requester, or part of a stronger supported authorization mechanism. UI and pitch must state the actual model.

## Cancellation, refunds, and disputes

### Failure cases the user must be able to understand

| Failure | Direct escrow (A) | Platform seller (B) |
|---|---|---|
| No filler accepts | No escrow funded; buyer keeps tokens | If buyer already funded the platform, use the platform-seller escrow's actual refund path |
| Filler accepted/funded but never bought anything | Tokens remain subject to escrow rules; exercise tested no-result/refund/dispute path before deadlines | Same buyer-facing native rules, with platform as seller; platform must resolve its filler assignment |
| Correct purchase placed, then canceled or never delivered before payout | Protection depends on agreed predicate and whether native refund/dispute remains available | Same timing issue; platform role alone does not prove delivery or guarantee refund |
| Correct purchase placed, payout completed, merchant fails to deliver | Original escrow no longer holds recoverable funds; no automatic clawback | Platform can only offer extra protection through an explicit guarantee/reserve or recovery policy; not inherent to B |
| Physical goods returned after payout | Separate merchant return/refund coordination required | Same merchant coordination, plus platform liability if it promised reimbursement |

Refund destination is the authorized buyer return path, not an arbitrary address supplied with a support request. Refund and payout race resolution belongs to the native contract and confirmed chain state, not which HTTP request reached the server first.

**Merchant returns are distinct from escrow refunds.** The filler purchased through their own account/card, so a merchant refund may go back to the filler while the buyer holds the goods and originally paid tokens. After escrow payout, this project has no automatic right to debit the filler. A production returns system needs agreed return shipping, merchant refund observation, filler repayment/bond or funded platform guarantee, and dispute handling. None is silently supplied by choosing A or B. The MVP covers purchase placement and native escrow failure/refund paths, not a complete physical-goods return service.

Before a claim/payment attempt, buyer may cancel the unfunded intent. During pending payment, reconcile before cancellation/reassignment. After funding, follow native refund/expiry rules; closing a database order cannot retrieve escrow.

For no purchase, rejected evidence or a missed deadline: collect the reason and evidence, request the available refund through the authorized buyer path in time, obtain seller authorization where required, and confirm the on-chain refund before marking `REFUNDED`. Do not promise instant or unconditional refunds.

For disputed purchase facts: freeze application settlement work, preserve proof, notify buyer/filler, and enter the actual protocol arbitration process where available. G3 must identify arbitrators, timing and operational access; a dashboard “resolve” button is not decentralized arbitration. Physical-goods cases may require human judgment outside the protocol's service-output model.

After final seller collection, later merchant refunds/chargebacks have no automatic clawback in this MVP. Record incidents and block repeat abusive fillers operationally; do not claim this restores buyer funds. Delivery insurance, bonds and return reconciliation are later product work.

## Security acceptance requirements

- A changed order, claim, recipient, seller, asset, amount, chain or policy invalidates verification authorization.
- A merchant purchase is consumable at most once across all evidence versions/orders; corrections to the same order can be rechecked without allowing a second payout.
- Wrong-wallet access to private recipient/evidence routes is denied; object IDs alone confer no access.
- Evidence uploads are private, size-limited, content-type checked and served as downloads rather than active HTML. Untrusted files/URLs never become instructions or arbitrary network requests.
- The backend accepts only allowlisted merchant/provider hosts and fixed endpoint templates; reject SSRF, redirects to private hosts, and filler-selected verification URLs.
- Signing keys are scoped by actor. Authentication tokens never allow changing the seller address after funding.
- Buyer monitoring tests include malicious seller result submission outside the application.
- Logs contain no seed phrases, raw payment cards, merchant passwords or street addresses.

Operational readiness for real purchases additionally requires merchant terms, privacy/retention obligations and applicable payment activity requirements to be assessed for the chosen region. This pack makes no claim of worldwide launch authorization or regulatory status.
