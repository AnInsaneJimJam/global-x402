# Application API and data contracts

These are proposed **Global Order Book** interfaces for selected architecture A, not Masumi or CRE APIs. Resolve the remaining merchant and protocol gates in document 00 before implementing their dependent integrations. Generate OpenAPI/JSON Schema from the final implementation and test the reference clients against it.

## Conventions

Base path `/v1`; JSON UTF-8; opaque IDs; UTC ISO-8601 timestamps; integer amounts encoded as decimal strings; explicit asset identifier, network and decimals. Fiat minor units use a currency-specific exponent. Clients cannot set native chain state or a verification verdict.

Authenticated mutations require `Idempotency-Key`. Bind it to actor, method, path and canonical body hash; same key/same body returns the original result, different body returns `409 IDEMPOTENCY_CONFLICT`. Stable payment/claim IDs remain unique beyond HTTP-key retention. Include `expectedVersion` on stateful mutations and reject stale updates.

Error envelope: `{ "error": { "code": "CLAIM_CONFLICT", "message": "Order is already reserved", "retryable": false }, "requestId": "..." }`. Use 400 for malformed input, 401/403 for authentication/authorization, 404 for absent or inaccessible private objects, 409 for state conflict, 422 for unsupported policy/merchant/asset, 429 for rate limits and 503 for dependency unavailability. Monetary outcomes remain pending on ambiguous failures.

## Authentication

`POST /auth/challenges` creates a short-lived, single-use nonce bound to origin/domain, network, wallet address and requested role. `POST /auth/sessions` verifies a supported wallet signature and grants a scoped short-lived session. In Cardano implementations validate the relevant key/address relationship, not just cryptographic validity. Expose a reference signer adapter compatible with the selected wallet.

Buyer agent authentication is framework independent; a wallet signature is sufficient for this application's session. Merchant credentials and blockchain-provider API keys remain private infrastructure details. Production seller registration/identity ownership is separate from merely owning any wallet.

## Routes

| Route | Caller | Behavior |
|---|---|---|
| `GET /capabilities` | Public | Modes, network/asset IDs, merchants, predicate versions, supported signer methods, integration status labels |
| `POST /intents` | Buyer | Validate/store purchase intent and private recipient; return `orderId`, quote, version and expiry |
| `GET /orders` | Filler/public | Cursor-paginated redacted available intents; filters by merchant, region, reward, status |
| `GET /orders/:id` | Authorized actor | Role-specific order view, supported transitions, funding/settlement timeline |
| `POST /orders/:id/claims` | Eligible filler | Atomic reservation, fixed seller identity/address and accepted quote; one active claim |
| `GET /orders/:id/assignment` | Funded assigned filler | Restricted delivery details and exact purchase terms; denied before funding |
| `POST /orders/:id/funding` | Buyer | In x402 mode return standards-compliant 402 challenge; paid retry acknowledges pending/confirmed funding idempotently |
| `GET /orders/:id/funding` | Buyer/assigned filler | Poll funding attempt and confirmation evidence; no second charge |
| `POST /orders/:id/evidence-uploads` | Assigned filler | Private short-lived upload destination with size/type restrictions |
| `POST /orders/:id/evidence` | Assigned filler | Merchant order reference and uploaded evidence IDs; enqueue independent verification, return 202 |
| `GET /orders/:id/result` | Buyer/assigned filler | Sanitized predicate result, evidence commitment, report provenance, native result hash |
| `POST /orders/:id/cancel` | Buyer | Cancel only if no pending/funded liability; otherwise indicate available refund route |
| `POST /orders/:id/refund-requests` | Buyer | Persist request and coordinate authorized native action; not an immediate refund promise |
| `POST /orders/:id/disputes` | Buyer/filler as allowed | Record reason/evidence and actual available protocol action; block unsupported roles |
| `POST /internal/verification-results` | Authenticated verifier consumer | Validate envelope and order binding, deduplicate, persist and enqueue lifecycle action |
| `GET /health` | Operations | Process health; expose dependency readiness without secrets |

Native-Masumi funding mode returns the tested native purchase instructions and monitoring reference instead of pretending to implement an x402 exchange. Publish this difference in `/capabilities` and client types. SSE updates are optional; polling is sufficient for MVP.

The filler reference agent uses these same claim/funding/evidence endpoints; it does not require a parallel privileged API. `/orders` returns enough fee, net-proceeds, eligibility and settlement-time data to evaluate an acquisition goal. Merchant credentials and acquisition goals can remain local to the filler's runtime. Record its checkout operation ID durably there and attach the resulting merchant reference to the evidence submission.

The filler runtime stores a `MerchantPurchaseAttempt` bound to order/claim, accepted SKU/quantity/recipient, expected fiat amount, merchant checkout session, operation ID and resulting merchant order ID. Its states are `PREPARED`, `SUBMITTING`, `UNKNOWN`, `ORDERED`, and `FAILED_CONFIRMED`. Persist `SUBMITTING` before the irreversible purchase call. An ambiguous response becomes `UNKNOWN`; perform a merchant lookup or human reconciliation before resubmission. Retry checkout only with documented merchant idempotency or definitive evidence that no purchase occurred. Repeated proof submission must never repeat checkout.

## Intent example (application schema)

```json
{
  "clientOrderId": "buyer-generated-unique-id",
  "merchantId": "demo-merchant",
  "item": { "sku": "coke-330ml-1", "quantity": 1 },
  "recipient": {
    "name": "Demo Recipient",
    "addressLine1": "Synthetic test address",
    "city": "Demo City",
    "postalCode": "00000",
    "country": "SG"
  },
  "fiat": { "currency": "USD", "maximumChargeMinor": "500" },
  "settlement": {
    "network": "cardano:preprod",
    "assetId": "RESOLVED_ALLOWLISTED_POLICY_AND_ASSET",
    "maximumEscrowBaseUnits": "BUYER_POLICY_LIMIT",
    "fillerRewardFiatMinor": "10"
  },
  "completionPredicate": "ORDER_PLACED_V1"
}
```

Symbolic asset/limit values deliberately make this a schema illustration, not an executable payment fixture. G1/G6 must replace them with validated actual asset identifiers and integer values. Do not mint a fake branded USDC token and present it as USDC. Use synthetic recipient information for the demo.

Server rejects an intent if the accepted total cannot fit the buyer maximum after actual fees. Quote response includes the detailed components defined in document 01 and a hash/version/expiry. After matching, the funding terms bind the exact filler and are rechecked against the buyer's policy.

## x402 funding behavior

1. Require the order to have a valid reserved filler. Build the selected scheme's payment requirements from immutable quote/claim data.
2. Bind the request body/intent commitment, order ID, claim ID, exact seller/return addresses, asset/amount, network, policy and deadlines in the scheme-supported signed terms. A URL-only SDK default commitment is insufficient for a parameterized purchase.
3. Reuse persisted issued terms for the paid retry. Validate seller authorization and registry claims with the selected SDK's hooks and independent registry checks.
4. Use the standard `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE` headers only as supported by the pinned x402 version. Persist facilitator/transaction evidence and return asynchronous order status. Test CORS/header exposure for the web client where needed.
5. Treat facilitator pending responses as pending. Observe the actual transaction and exact output/datum before moving to `FUNDED`; require a configured confirmation depth supported by the provider.
6. Persist handler execution and payment states separately: SDKs may invoke a resource handler before final settlement. The handler cannot authorize fiat purchase or return private assignment data before confirmed funding.

No endpoint may request both a direct $5.10 payment and another $5.10 escrow lock for the same principal.

## Persistence model

| Entity | Essential fields and invariants |
|---|---|
| Principal | Role, verified wallet/network, session scopes, seller identity reference; private key absent |
| Order | Buyer ID, clientOrderId unique per buyer, merchant/SKU/quantity, private recipient ID, commitment, quote ID, policy version, state/version |
| Quote | Immutable cost/reward/fees/gross/net, asset/network, deadlines, accepted version, subsidy, expiry |
| Claim | Order, filler, seller identity/key/address, version, lease, state; one active claim per order |
| FundingAttempt | Claim/quote/terms digest, signed-term reference, payment mode, transaction ID, output reference, status, observed depth; immutable claim binding |
| Escrow | Native identifier, contract/validator version, fixed parties, amount/asset, exact native deadlines, native state and observation source |
| Evidence | Claim, merchant order reference encrypted at rest, unique keyed merchant-order digest, private object refs, checksum, source and upload time |
| Verification | Evidence version/hash, expected terms hash, policy version, verdict/reasons, workflow identity, nonce, raw envelope ref, expiry, mode |
| ChainOperation | Stable operation ID, action/actor, unsigned/signed submission references as appropriate, tx hash, output, status, retry history |
| AuditEvent | Order, actor, old/new app state, reason, causation/correlation IDs, timestamp; append-only application history |
| OutboxJob | Dedupe key, payload reference, attempts, lease and next attempt time; committed alongside its state transition |

Use a keyed digest to index merchant orders without exposing guessable IDs. Unique `(merchantId, merchantOrderDigest)` prevents cross-order reuse; evidence revisions within the same order reuse that binding. Only one accepted result per active evidence version and one terminal monetary allocation per escrow can exist.

## Internal adapter interfaces

These describe responsibilities rather than guaranteed third-party methods:

- `PaymentAdapter`: create scheme-specific terms; validate/follow funding; read escrow; submit an authorized lifecycle action; determine currently available actions; estimate exact costs. It exposes its mode and capability flags. Unsupported transitions are explicit errors.
- `MerchantAdapter`: validate product; quote landed cost; fetch authorized order observation; normalize status, purchaser and recipient facts. It must not trust filler-derived fields as authoritative.
- `Verifier`: evaluate versioned expected/observed facts; return bound result and provenance. It cannot hold settlement keys.
- `BuyerSigner` / `SellerSigner`: actor-specific signing in a separately controlled runtime. The backend receives permission to request only the chosen actions, not arbitrary transactions.

## Configuration to resolve in G1–G6

Network/provider, contract address/blueprint hash, asset policy/name/decimals, SDK/Node/CLI versions, facilitator confirmation policy, all native deadlines, fee payer policy, merchant host and credential scope, evidence age and retry budget, workflow identity/report trust source, signer ownership, object retention period, and operator alert channel. No secret values belong in the integration manifest or committed examples.
