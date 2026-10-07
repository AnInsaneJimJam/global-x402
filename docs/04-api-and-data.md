# Application API and data contracts

These are proposed **Global Order Book** interfaces for selected architecture A, not Masumi or CRE APIs. Resolve the remaining merchant and protocol gates in document 00 before implementing their dependent integrations. Generate OpenAPI/JSON Schema from the final implementation and test the reference clients against it.

Agents and the dashboard consume one domain interface through the named routes below. [Document 07](07-agent-system.md) owns the interaction rules; this document owns field meanings, versioning and transport mappings. The reference client groups these routes into typed `inspect` and `act` primitives. This is client ergonomics, not a second server with independent state.

## Conventions

Base path `/v1`; JSON UTF-8; opaque IDs; UTC ISO-8601 timestamps; integer amounts encoded as decimal strings; explicit asset identifier, network and decimals. Fiat minor units use a currency-specific exponent. Clients cannot set native chain state or a verification verdict.

Discovery, status, operation recovery and evidence explanation reads require no additional user payment in the MVP. Operator infrastructure costs are tracked separately. The selected funding route is the x402 payment exchange; a client must never automatically pay an unexpected challenge from a status or schema endpoint. All user-facing fees belong to the accepted quote or a separately authorized action.

Authenticated mutations require `Idempotency-Key` and a durable `operationId` bound to actor, command, target and canonical effect hash. Repeating the same business operation returns its existing receipt even after a client restart. Reusing either identity with changed effects returns `409 OPERATION_CONFLICT`. Transport-key expiry never deletes the business-operation uniqueness constraint. Preserve monetary deduplication tombstones for the lifetime of the retained obligation; archival cannot authorize repeating the effect.

Committing a prepared domain action binds `planId` and `expectedControlVersion` where it acts on an existing order. Preparation itself, authentication and authenticated observation ingestion do not recursively require a prepared plan; they use their own identity, deduplication and validation contracts. `controlVersion` changes when facts relevant to eligibility, terms, authority or protection change; `observationRevision` also advances for non-decision history. A new heartbeat need not invalidate a funding plan. Deadline/expiry checks use current trusted time even when neither version changes. Plan commitment also checks its exact terms/claim/evidence/policy bindings and execution epoch; a generic latest-version number is insufficient.

Error envelope: `error` contains `code`, `message`, `effectStatus`, `recovery`, `operationId` when assigned, `retryAfter` when meaningful, `detailsRef` and `controlRef`; the envelope includes `requestId`. `effectStatus` is `NOT_STARTED`, `PENDING`, `OUTCOME_UNKNOWN` or `OBSERVED_COMPLETE`. `recovery` is `REFRESH`, `WAIT`, `RECONCILE`, `REAUTHORIZE`, `CHANGE_INPUT` or `INTERVENE`. Transport retryability alone cannot prescribe a safe monetary retry. Use 400 for malformed input, 401/403 for authentication/authorization, 404 for absent or inaccessible private objects, 409 for conflicts, 422 for unsupported policies, 429 for rate limits and 503 for dependency unavailability. A rejected *new* command is `NOT_STARTED`; an HTTP error retrieving an existing pending operation must retain that operation's actual uncertainty.

## Authentication

`POST /auth/challenges` creates a short-lived, single-use nonce bound to origin/domain, network, wallet address and requested role. `POST /auth/sessions` verifies a supported wallet signature and grants a scoped short-lived session. In Cardano implementations validate the relevant key/address relationship, not just cryptographic validity. Expose a reference signer adapter compatible with the selected wallet.

Buyer agent authentication is framework independent; a wallet signature is sufficient for this application's session. Merchant credentials and blockchain-provider API keys remain private infrastructure details. Production seller registration/identity ownership is separate from merely owning any wallet.

Authentication, action authorization and transaction signing are distinct. Scope sessions by actor, role, resource and command family; preserve issuer/audience/expiry and revoke or narrow them without silently canceling existing operations. Actor-local grants bind goal, exact permitted effects, ceilings, asset/network, merchant/recipient constraints and expiry. Report whether a limit is enforced by the coordinator, local runner, wallet or merchant; the coordinator cannot enforce unrelated card spend. Possessing a plan/receipt/continuation ID is never authority. The actor's signer checks actual transaction effects independently before signing.

## Capability and control contracts

`CapabilitySummary` includes `contractVersion`, `schemaHash`, supported commands, integration configurations/assets/merchants/predicates, adapter configuration fingerprints, conformance evidence references, and detailed schema links. Each capability distinguishes `configured`, `tested`, `availableNow` and the integration identity below; current health has a separate freshness bound. `GET /capabilities/:id` returns the input/output schemas, success evidence, side effects, authority, recovery semantics and limitations for that capability. Cache schema descriptions by hash; recheck short-lived readiness before effects.

`IntegrationIdentity` is the authoritative representation of execution labels:

- `payment.protocol`: `X402_MASUMI` or `MASUMI_NATIVE`; `payment.network`: exact configured network identifier; `payment.execution`: `LIVE` or `MOCK`. LIVE on Preprod is a real testnet transaction, not a mainnet payment. MOCK identifies simulation of the declared protocol, not a third payment protocol.
- `merchant.environment`: `LIVE`, `SANDBOX` or `MOCK`; `merchant.checkout`: `AUTOMATED` or `HUMAN_ASSISTED`; merchant/adapter identity and configuration fingerprint accompany these fields.
- `verifier.execution`: `CRE_DON`, `CRE_SIMULATION`, `MANUAL` or `MOCK`; deployed workflow identity/environment and signer trust configuration are present where applicable.

Display labels such as "LIVE TESTNET" and "LOCAL SIMULATION" are derived from these fields, not independently stored booleans. Omit an unavailable layer and expose its capability blocker rather than defaulting it to live. This identity accompanies capability records, control views, relevant receipts and conformance traces; consumers validate it against authenticated source/configuration evidence, not just a supplied string.

`ControlView` is a role-filtered projection, not a new mutable aggregate:

| Field | Meaning / required invariant |
|---|---|
| `schemaVersion`, `scope`, `viewer` | Versioned contract, resource type/ID, authenticated actor/role; unknown major versions fail closed for writes |
| `controlVersion`, `observationRevision`, `generatedAt`, `cursor` | Decision version, observation version, trusted generation time, resumable event position |
| `summary`, `integration` | Short deterministic explanation and IntegrationIdentity with independent merchant/verifier/payment execution fields |
| `outcome` | Separate placement, verification, settlement and goal results; derived from facts, never client-writable |
| `termsRef`, `termsHash`, `claimId` | Links to immutable authorized commercial context |
| `facts[]` | Typed `key`/`value`, `state` (`OBSERVED/NOT_OBSERVED/UNKNOWN/CONTRADICTED`), `sourceType`/`sourceRef`, `observedAt`, freshness/finality data and superseded observation ref |
| `exposure[]` | Separate committed/reserved/unknown/realized amounts in explicit fiat/token units, owner and operation; no misleading single spend total |
| `obligations[]` | Obligation ID/type, actor owner, status, deadline source/time, computed safeActBy and its assumptions, monitor owner/health/last check |
| `actions[]` | Finite typed commands with schema ref, immutable action binding, execution owner, AVAILABLE/BLOCKED status, reasons, required authority and plan link; availability is not permission |
| `wait` | Next relevant wake/deadline, cursor and retry/read conditions; no-change response preserves still-active obligations |
| `links` | Scoped references to operations, terms, evidence and explanations; no bearer secrets or raw card data |

`inspect` in the actor runtime composes this projection with the private `RunCheckpoint`. It returns both source revisions and marks the view inconsistent if a required journal/observation cannot be loaded. Local purchase reports cannot overwrite independently verified merchant facts. Enumerate every fact's actual authority in the adapter contract rather than treating all returned JSON as equally trustworthy.

### Prepared action and durable receipt

`ActionPlan` contains plan/command/actor/resource IDs; preparation and expiry times; exact accepted terms/claim/evidence/policy bindings; expected control version and execution epoch; deterministic policy evaluation; effects and maximum cost by asset/currency; data disclosures; required authority/signers; adapter capability/configuration version; ordering/preconditions; success evidence and recovery contract. Preparation performs read/validation and durable plan storage, with bounded protocol quote issuance only as defined in document 07; it creates no spending signature, monetary effect or new claim. Plans requiring an unknown monetary upper bound or unsupported predicate are blocked. A local runner may automatically prepare and commit under an existing grant without involving a model or asking the user again.

`OperationReceipt` contains operation/command/actor/executor IDs; effect hash; plan/terms binding; `PREPARED/ACCEPTED/PENDING/OUTCOME_UNKNOWN/SUCCEEDED/REJECTED/FAILED_CONFIRMED` status; externally observed references when present; creation/update times; linked obligations; source evidence; safe recovery directive; and next inspection reference. `FAILED_CONFIRMED` means definitive failure with known effects, not timeout. Successful evidence submission means the evidence was accepted for checking, not that it passed. Terminal monetary outcomes need observed transactions; an HTTP 200 cannot prove them.

The coordinator owns coordinator operations; wallet/payment and checkout runtimes own their actor-local journals. Correlate them through shared business operation IDs and explicit sub-operation references. Record an outbox/operation before executing remote effects; reconcile after uncertain submission. Never claim distributed atomicity across the database, merchant and chain.

Preparation ownership is explicit. The coordinator's `/action-plans` prepares application-admission plans for order/claim changes, funding and native lifecycle requests; it stores the canonical terms/preconditions and the selected adapter's supported effect description. Their named commit routes accept that coordinator `planId`. The buyer/seller runtime separately persists a signer execution plan, linked by `parentPlanId`/effect hash, validating actual transaction inputs/outputs, fees and grants before signing. Actor-local checkout and run-control plans are prepared/stored locally; purchase registration links their effect hash and stable operation ID to the coordinator's admissible assignment. Local plan IDs alone are never accepted as coordinator authority. When actual transaction effects exceed or differ from the admitted plan, obtain a fresh plan instead of signing a different effect. Neither preparation owner can grant another actor's authority.

Deduplicate an already admitted operation before applying a new plan-expiry or control-version check: returning its receipt after a timeout is observation, not permission to re-execute it. A replacement effect needs a new operation only after the old one is definitively reconciled and current authority permits it. Canonical effect hashes exclude transport timestamps and request IDs, but include every term that can change money, recipient, disclosure or authorized behavior.

### Command catalogue and execution owner

| Command family | Owner of effect | Additional checks |
|---|---|---|
| Create intent / claim / cancel unfunded intent | Coordinator | Exact intent, eligibility, atomic active claim and terms/version constraints |
| Withdraw claim | Owning filler through coordinator | Stop fresh funding terms, then reconcile already valid/pending funding before safe release; funded liability is not discarded |
| Fund escrow | Buyer signer and selected x402/native adapter | Actual transaction effects, budget reservation, seller/asset/chain, no unresolved funding attempt |
| Purchase | Filler runtime and merchant adapter | Confirmed funding, registered and journaled purchase attempt, exact checkout, local fiat policy; neither an unresolved nor a successful prior purchase exists for the assignment |
| Submit evidence | Coordinator | Assigned filler, merchant-order uniqueness and existing purchase reference; never repeat checkout |
| Request refund / dispute | Actual authorized buyer/seller signer via adapter | Native eligibility, current deadline, evidence/terms binding and signer authority |
| Submit result / authorize refund / collect | Actual authorized seller signer via adapter | Actual native capability, predicate/obligation policy, current chain observation and unresolved tx check |
| Stop new commitments / resume | Actor-local runner | Existing obligations remain monitored; resume uses same journal, authority and accepted terms |

`start_run` is an actor-local typed command, not a hosted autonomous-agent endpoint. Input is a purchase objective or acquisition objective, policy/grant references, supported capability version and stable client-run operation ID. It persists the goal before beginning any domain effects and returns `runId`, local revision, readiness blockers and initial control links. `inspect` accepts `scope.kind = run` to resume it, alongside the other scopes. `stop_new_commitments` and `resume` bind the local run revision/epoch. Repeated start with the same ID returns the same run; changed objectives conflict. Starting a run does not broaden authority or execute through a blocker. Generated guides show start → inspect → act/wait → stop/resume.

Commands have distinct schemas and handlers even when the client groups them under `act`. A server-returned action cannot name arbitrary hosts, executable code, keys or unsupported commands. Remote schemas are data fetched from configured authenticated origins; tools use the installed versioned command registry.

## Routes

| Route | Caller | Behavior |
|---|---|---|
| `GET /capabilities` | Public | Compact versioned capability summary; expanded contracts fetched only as needed |
| `GET /capabilities/:id` | Public/authorized by fields | Detailed versioned command contract; content-addressed caching |
| `GET /readiness` | Authenticated actor | Role-specific capability, credential, signer and monitoring blockers without revealing secrets |
| `POST /action-plans` | Authorized actor | Prepare coordinator admission for finite domain commands, including signer-owned funding/lifecycle effects; no financial or claim side effect |
| `GET /work` | Authenticated actor | Bounded summary of owned nonterminal orders, unknown operations and nearest obligations; recover after session loss |
| `GET /operations/:id` | Authorized actor | Durable operation receipt; stable lookup after timeout |
| `GET /events` | Authenticated actor | Ordered authorized events after opaque cursor; bounded long poll, no private cross-actor data |
| `POST /intents` | Buyer | Validate/store purchase intent and private recipient; return `orderId`, quote, version and expiry |
| `GET /orders` | Filler/public | Cursor-paginated redacted available intents; filters by merchant, region, reward, status |
| `GET /orders/:id` | Authorized actor | Stable order resource and detail links; same underlying projection as control view |
| `GET /orders/:id/control` | Authorized actor | Decision-ready ControlView; conditional read/delta/full-snapshot recovery |
| `POST /orders/:id/claims` | Eligible filler | Atomic reservation, fixed seller identity/address and accepted quote; one active claim |
| `POST /orders/:id/claims/:claimId/withdrawal-requests` | Owning filler | Register withdrawal and stop issuing fresh funding terms; release only after existing payment liability is resolved |
| `GET /orders/:id/assignment` | Funded assigned filler | Restricted delivery details and exact purchase terms; denied before funding |
| `POST /orders/:id/purchase-attempts` | Assigned filler | Atomically register bound checkout obligation before actor-local purchase; reject any unresolved or successful competing attempt for the same assignment |
| `POST /orders/:id/purchase-attempts/:attemptId/observations` | Owning filler runtime | Append local outcome/checkpoint reference; remains actor-reported, never merchant proof |
| `POST /orders/:id/funding` | Buyer | In x402 mode return standards-compliant 402 challenge; paid retry acknowledges pending/confirmed funding idempotently |
| `GET /orders/:id/funding` | Buyer/assigned filler | Poll funding attempt and confirmation evidence; no second charge |
| `POST /orders/:id/evidence-uploads` | Assigned filler | Private short-lived upload destination with size/type restrictions |
| `POST /orders/:id/evidence` | Assigned filler | Merchant order reference and uploaded evidence IDs; enqueue independent verification, return 202 |
| `GET /orders/:id/result` | Buyer/assigned filler | Sanitized predicate result, evidence commitment, report provenance, native result hash |
| `POST /orders/:id/cancel` | Buyer | Cancel only if no pending/funded liability; otherwise indicate available refund route |
| `POST /orders/:id/refund-requests` | Buyer | Persist request and coordinate authorized native action; not an immediate refund promise |
| `POST /orders/:id/disputes` | Buyer/filler as allowed | Record reason/evidence and actual available protocol action; block unsupported roles |
| `POST /orders/:id/escrow-actions` | Authorized signer runtime | Closed typed result/refund-authorization/collection actions; available only when tested adapter and signer support them |
| `POST /internal/verification-results` | Authenticated verifier consumer | Validate envelope and order binding, deduplicate, persist and enqueue lifecycle action |
| `GET /health` | Operations | Process health; expose dependency readiness without secrets |

Native-Masumi funding mode returns the tested native purchase instructions and monitoring reference instead of pretending to implement an x402 exchange. Publish this difference in `/capabilities` and client types. Use cursor-based bounded long polling or conditional reads in the deterministic runner for MVP; SSE is an optional transport adapter. Neither requires repeated LLM inference.

The client `act` dispatcher commits a prepared action through its existing named mutation route. The application-side prepare envelope does not replace x402 payment requirements or wallet verification. Actor-local purchase preparation stays local; coordinator registration is a prerequisite, not permission to use the filler's payment method. Bootstrap intent creation has no existing order version but still binds actor, policy, effect hash and operation ID.

Claim withdrawal is a request, not immediate cancellation. Atomically mark the claim as withdrawing and exclude it from new funding-term issuance. Already issued valid terms, signed transactions and pending funding cannot be invalidated merely by changing application state. Retain the claim, observe through the applicable validity/reconciliation window, and either release after definitive no-funding evidence or enter funded refund/protection handling. A concurrent buyer-funding commit and withdrawal have one serialized application admission outcome, while any externally valid earlier transaction remains an observed liability. The filler runner journals and retries the withdrawal request on stop; an unacknowledged notification remains a visible obligation.

Event contract: `eventId`, monotonic authorized-feed `sequence`, `kind`, resource/operation IDs, resource observation revision, `observedAt`, and changed-field references. Delivery is at least once; deduplicate by ID, tolerate duplicates and reject silent gaps. `CURSOR_EXPIRED` returns a full-snapshot recovery instruction; reload `/work` and relevant control views, including overdue obligations. Long-poll timeout means no new event, not no outstanding work. Every wait is bounded by the earlier of transport limit and safe action time.

Capture each snapshot and its event watermark consistently so events occurring between inspection and subscription cannot be lost. Cursors bind actor, scope, filters and authorization revision. Define sequence continuity within that authorized feed, not a global counter whose hidden events would appear as gaps. Scope/permission changes return `CURSOR_SCOPE_CHANGED` and require a refreshed authorized snapshot. Private response caching is partitioned by actor/role and authorization revision; a shared ETag cannot reveal another actor's view.

The filler reference agent uses these same claim/funding/evidence endpoints; it does not require a parallel privileged API. `/orders` returns enough fee, net-proceeds, eligibility and settlement-time data to evaluate an acquisition goal. Merchant credentials and acquisition goals can remain local to the filler's runtime. Record its checkout operation ID durably there and attach the resulting merchant reference to the evidence submission.

The filler runtime stores a `MerchantPurchaseAttempt` bound to order/claim, accepted SKU/quantity/recipient, expected fiat amount, merchant checkout session, operation ID and resulting merchant order ID. Its states are `PREPARED`, `SUBMITTING`, `UNKNOWN`, `ORDERED`, and `FAILED_CONFIRMED`. Persist `SUBMITTING` before the irreversible purchase call. An ambiguous response becomes `UNKNOWN`; perform a merchant lookup or human reconciliation before resubmission. Retry checkout only with documented merchant idempotency or definitive evidence that no purchase occurred. Repeated proof submission must never repeat checkout.

Coordinator registration and the actor-local journal use the same operation ID. During `UNKNOWN`, the control view explicitly blocks a new purchase even if the order's coarse status is still `FUNDED`. Unreachable/missing local state triggers reconciliation/intervention, never an empty fresh journal. Status updates from the actor do not substitute for independent evidence.

The local `MerchantPurchaseAttempt.UNKNOWN` maps to `OperationReceipt.OUTCOME_UNKNOWN`. An attempt remaining `SUBMITTING` across a crash also requires reconciliation; it is not safe to assume the remote call was never made. A registered attempt with definitive evidence that checkout was never invoked may be closed without inventing a merchant order. Registration timeouts are reconciled by the same ID before proceeding.

Each funded assignment permits at most one successful merchant purchase. An `ORDERED` attempt permanently blocks another purchase for that assignment, including a different operation ID while the coarse order still says `FUNDED`. Continue with evidence/verification instead. Coordinator registration and actor-local admission enforce the invariant atomically. A replacement attempt requires definitive no-purchase reconciliation of every prior attempt; a previously successful order that was later canceled does not satisfy that condition and follows recovery/refund handling instead.

### Example: a fresh agent resumes an ambiguous checkout

This is an illustrative excerpt from the composed agent view, not a runnable payment request or a complete schema instance:

```json
{
  "scope": { "kind": "order", "id": "order-example" },
  "summary": "Escrow is funded; purchase outcome is unknown. Reconcile the existing checkout.",
  "facts": [
    { "key": "merchantPurchase", "value": null, "state": "UNKNOWN", "sourceType": "ACTOR_REPORT", "sourceRef": "purchase-example" }
  ],
  "actions": [
    { "command": "purchase", "status": "BLOCKED", "reasonCodes": ["UNRESOLVED_PURCHASE"] }
  ],
  "obligations": [
    { "type": "RECONCILE_PURCHASE", "owner": "filler-runtime", "operationId": "purchase-example" }
  ],
  "links": { "operation": "/v1/operations/purchase-example" }
}
```

The runtime loads the existing merchant reference/idempotency key from its protected journal and performs the adapter's permitted lookup. Merchant-confirmed placement leads to evidence submission; definitive no-purchase evidence permits a fresh authorized plan; inconclusive lookup keeps the purchase blocked and exposes intervention/deadline requirements. The model does not reconstruct a cart or infer a retry from a generic error.

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
| ActionPlan / Operation | Prepared effect and bindings; durable deduplication and execution/recovery receipt; reuses ChainOperation through a shared operation reference, not two payment state machines |
| Obligation / Monitor | Durable owner, referenced order/operation, deadline/next wake and health; projections derive current eligibility from facts |
| RunCheckpoint (actor-local) | Goal, policy/grant refs, active operation IDs, fiat/token reservations, cursor, execution epoch and continuation; credentials stored separately |

Use a keyed digest to index merchant orders without exposing guessable IDs. Unique `(merchantId, merchantOrderDigest)` prevents cross-order reuse; evidence revisions within the same order reuse that binding. Only one accepted result per active evidence version and one terminal monetary allocation per escrow can exist.

Record the authoritative version of each accepted term once. Views, actions, receipts and evidence link to it by ID/hash instead of storing mutable copies. `ControlView` and `outcome` are derived views; do not create additional independently editable status tables. Durable obligation scheduling is updated transactionally with the events that create or resolve it.

## Internal adapter interfaces

These describe responsibilities rather than guaranteed third-party methods:

- `PaymentAdapter`: create scheme-specific terms; validate/follow funding; read escrow; submit an authorized lifecycle action; determine currently available actions; estimate exact costs. It exposes its mode and capability flags. Unsupported transitions are explicit errors.
- `MerchantAdapter`: validate product; quote landed cost; fetch authorized order observation; normalize status, purchaser and recipient facts. It must not trust filler-derived fields as authoritative.
- `Verifier`: evaluate versioned expected/observed facts; return bound result and provenance. It cannot hold settlement keys.
- `BuyerSigner` / `SellerSigner`: actor-specific signing in a separately controlled runtime. The backend receives permission to request only the chosen actions, not arbitrary transactions.

Each external adapter declares supported actions, provenance types, configuration fingerprint, deadline/confirmation behavior, effect idempotency, reconciliation lookup and uncertainty semantics. A test adapter supplies the same interface with scripted failures; live capability status requires actual conformance evidence, not passing mock tests. Keep pure policy/normalization functions in-process rather than giving each a service port.

## Configuration to resolve in G1–G6

Network/provider, contract address/blueprint hash, asset policy/name/decimals, SDK/Node/CLI versions, facilitator confirmation policy, all native deadlines, fee payer policy, merchant host and credential scope, evidence age and retry budget, workflow identity/report trust source, signer ownership, object retention period, and operator alert channel. No secret values belong in the integration manifest or committed examples.
