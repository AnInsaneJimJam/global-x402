# CRE and purchase-proof feasibility

Research date: 2026-10-07. Scope: official CRE capabilities, Amazon evidence access, and an implementable proof adapter for Global Order Book. This is technical research and a proposed integration boundary, not a decision about when the product pays fillers.

## Conclusions

CRE can fetch order evidence, execute deterministic verification logic, and deliver signed results to an HTTP receiver. It cannot make an arbitrary uploaded receipt truthful or make an unsupported blockchain integration exist. The practical first demonstration is a controlled merchant API, a real CRE workflow running in clearly identified simulation or deployed mode, and an explicitly trusted Cardano settlement adapter. The backend must independently validate reports and enforce order state before asking the actual escrow integration to act.

Amazon remains the motivating user story. Universal automatic verification of arbitrary consumer Amazon purchases is not established by the official APIs reviewed here. An authorized Amazon Business integration is a possible subsequent route, with onboarding and data-access prerequisites.

## Verified CRE capabilities and boundaries

| Capability | Verified fact | Consequence for this project |
| --- | --- | --- |
| Workflow execution | Go and TypeScript workflows compile to WASM; deployed execution uses DONs. Local simulation can call live external APIs. [Overview](https://docs.chain.link/cre/overview) | Use a dedicated workflow package; identify execution mode in the demo. |
| HTTP reads | Regular HTTP requests run across nodes in deployment; simulation uses single-node consensus. [HTTP capability](https://docs.chain.link/cre/capabilities/http) | Consensus helps verify execution and agreement on an API response. It does not independently prove the merchant's claims. |
| Direct blockchain access | The documented chain families are EVM and Solana; Solana is write-only. Cardano is not in this supported-family list. Tenant-enabled networks can be inspected with `cre workflow supported-chains`. [Supported networks](https://docs.chain.link/cre/supported-networks-ts) | Do not promise a native CRE Cardano write capability. The Cardano adapter is application infrastructure with its own authority and trust. |
| Deployment access | Deployment requires approval, requested with `cre account access`; simulation can continue while approval is pending. Private registry selection governs workflow lifecycle management, not confidentiality. [Deployment](https://docs.chain.link/cre/guides/operations/deploying-workflows) | Request access early; retain an honest simulation demonstration if approval is unavailable. |
| Secrets | Simulation resolves declared secrets from environment variables or `.env`; deployed workflows use the Vault DON. [Secrets in simulation](https://docs.chain.link/cre/guides/workflow/secrets/using-secrets-simulation-ts) | Keep credentials out of the repository, evidence objects, screenshots, and logs. |
| Confidential HTTP | It reaches quorum on request parameters, injects Vault DON secrets inside an enclave, makes one outbound request, and optionally encrypts its response. It does not make arbitrary surrounding workflow logic confidential. [Confidential HTTP](https://docs.chain.link/cre/capabilities/confidential-http-ts) | Potential credential protection for merchant integrations, not a prerequisite for the minimal synthetic-data demo. |

### SDK semantics that the implementation agent must preserve

Use the pinned TypeScript SDK's actual interfaces. The documented HTTP pattern uses `HTTPClient.sendRequest` with a fetching/parsing function, or `runInNodeMode` for more involved logic. Examples use `HTTPSendRequester.sendRequest(req).result()`. Use the supported aggregation method on a normalized result; do not aggregate arbitrary timestamps or average booleans. Redirecting HTTP URLs are unsupported. Time-sensitive request construction should use `runtime.now()` rather than each node's local wall clock. [GET requests](https://docs.chain.link/cre/guides/workflow/using-http-client/get-request-ts)

Every trigger invocation is a new stateless execution. Persistent reservations, merchant-order uniqueness, disputes, and settlement locks therefore belong in the application database and escrow state, not module variables inside a CRE callback. [CRE overview](https://docs.chain.link/cre/overview)

`runtime.report()` creates the report; the HTTP submission path can transmit the report, context, and signatures. The receiver must verify it. A plain webhook claiming `verified: true` is not a substitute. Follow the official report submission format and pin the encoding in an integration fixture. [Submitting reports](https://docs.chain.link/cre/guides/workflow/using-http-client/submitting-reports-http-ts)

Confidential HTTP callers should use `vaultDonSecrets` and placeholder injection rather than interpolating secrets obtained into ordinary workflow strings. With encrypted output, ordinary workflow code cannot inspect the plaintext response. For this project's minimum implementation, return only non-PII order verification fields from a controlled merchant endpoint. Full private computation would require a separate capability/access spike. [Confidential HTTP](https://docs.chain.link/cre/capabilities/confidential-http-ts)

### Report verification is a separate security boundary

Official receiver documentation provides both a CRE `Report.parse()` path and an external-server verification example using standard cryptography. `Report.parse()` requires a CRE runtime. Verification reads authorized DON signers and fault tolerance from the Ethereum Capability Registry, checks the report hash and an `f+1` signature threshold, and exposes metadata including workflow ID, owner, and execution ID. Simulation uses local test signing keys, so its reports fail production-registry verification by design. [Offchain verification](https://docs.chain.link/cre/guides/workflow/using-http-client/verifying-reports-offchain-ts)

Project requirements beyond that educational example:

- Count distinct authorized signer identities; duplicate signatures must not increase the quorum count.
- Pin the intended environment, registry, DON policy, workflow ID/version and owner. A correctly signed report from another workflow is unauthorized.
- Fail closed on unknown encodings, malformed lengths, registry unavailability, stale signer configuration, invalid signatures, or missing expected fields.
- Define cache refresh and DON reconfiguration behavior before production. Do not keep signer data forever merely because an example does.
- Verify the exact signed body, then enforce the application binding and replay rules below. Signature validity alone does not authorize payment.
- Never deploy a receiver with signature checks disabled. Simulation has a separate adapter, endpoint and keys that cannot operate a live-money escrow.

## Amazon access: what is and is not established

Amazon's Selling Partner Orders API is explicitly sellers-only, and its current documented version is `v2026-01-01`. The sandbox is static. [Orders API](https://developer-docs.amazon.com/sp-api/docs/orders-api)

SP-API applications act for an authorizing selling partner; public applications use selling-partner OAuth authorization, and private applications have self-authorization. PII access involves restricted roles. A consumer filler supplying an Amazon order ID does not establish those permissions. [SP-API onboarding](https://developer-docs.amazon.com/sp-api/docs/onboarding-overview)

Amazon Business has a separate Reporting API for authorized business order history, shipment, and payment data. Its documented prerequisites include developer onboarding, an app client, access/refresh tokens, and the Amazon Business Analytics role. This makes it a plausible limited integration for eligible business purchasers, rather than evidence of universal consumer-account access. [Reporting API overview](https://docs.business.amazon.com/docs/reporting-api-overview), [Order by ID](https://docs.business.amazon.com/docs/order-by-order-id)

**Inference and proposed boundary:** ship one supported merchant adapter at a time, with an explicit access agreement and verified fields. Do not promise that CRE can log into any consumer Amazon account, bypass MFA, obtain an API key automatically, or derive delivery truth from screenshots. The buyer-facing commerce protocol may avoid buyer API keys while merchant integrations and the operator still need service credentials.

## Proposed hackathon proof design

The following is a project design recommendation, not an assertion that these services or contracts already exist.

### Merchant evidence fixture

Build a clearly labeled demo merchant, not a fake Amazon API. It offers one product and one currency, accepts a sandbox checkout, and persists orders independently of the filler proof submission. The filler receives a merchant order reference after checkout. Only the merchant backend/payment sandbox event handler may mark the payment state as confirmed; the filler cannot write verification state directly.

Expose an authenticated HTTPS verification endpoint with a fixed response schema. A useful minimum snapshot is:

```text
merchantId, merchantOrderId, merchantOrderVersion
purchaseReference, productId, quantity
currency, totalMinor, paymentStatus, orderStatus
destinationCommitment, createdAt, lastChangedAt
```

`purchaseReference` binds the merchant checkout to the Global Order Book order and its currently assigned claim. Store a random, unpredictable reference issued by the backend before purchase. Define `destinationCommitment` from a canonical address representation plus a per-order high-entropy salt; a naked address hash can reveal guessable personal data. The controlled merchant recomputes the commitment from the actual checkout destination. An API that simply echoes the filler-submitted commitment proves nothing about the address.

The endpoint must never return PAN, CVV, merchant session cookies, or raw delivery address. Keep customer data off public report bodies and chain metadata. A real merchant adapter that cannot independently verify a required field returns `UNVERIFIABLE`, rather than making a positive assumption.

### Workflow

1. The backend accepts a proof reference for an active claim, stores the submission, and triggers verification with only stable identifiers. The payload cannot select an arbitrary URL, merchant trust root, policy, recipient, or amount.
2. CRE retrieves immutable intent/claim commitments from the protocol and the snapshot from an allowlisted merchant endpoint. An intent snapshot must itself correspond to the buyer-authorized order; a backend's mutable JSON is not sufficient evidence of original intent.
3. Normalize the response, validate its schema, and compare merchant, product, quantity, currency, amount rule, destination commitment, claim reference, and status against the accepted order terms. An LLM is unnecessary for these checks.
4. Emit `VERIFIED`, `REJECTED`, or `INCONCLUSIVE` with structured reason codes and an evidence digest. Transport/authentication failure is inconclusive, not a successful purchase or a terminal accusation of fraud.
5. Deliver the signed report. The backend verifies signatures and bindings, records the evidence, and lets the order state machine decide the next transition.
6. Only the settlement adapter designated by the chosen Masumi integration may submit a release operation. The adapter rechecks escrow state and order policy, uses an idempotent settlement job, and confirms the chain outcome before marking settlement final.

Payout policy is deliberately not chosen here. `PAID`, `ACCEPTED`, `SHIPPED`, and `DELIVERED` are different facts. A successful payment can be refunded; an accepted order can be cancelled; shipment is not receipt. The final specification must choose a trigger, challenge/cancellation window, and residual-risk owner. CRE should report observations rather than erase these distinctions.

### Required signed application binding

Include all fields required to prevent moving a valid proof to another context:

```text
schemaVersion, deploymentEnvironment, verifierPolicyVersion
orderId, orderVersion, intentHash, claimId, claimVersion
buyerWalletId, fillerPayoutAddress
cardanoNetwork, escrowReference, settlementAssetId, settlementAmountAtomic
merchantId, merchantOrderId, merchantOrderVersion, purchaseReference
destinationCommitment, evidenceDigest, observedStatus
verdict, reasonCodes, issuedAt, expiresAt, verificationRequestId
```

Use integer minor/atomic units serialized without floating-point rounding. Specify canonical encoding and hash algorithm in the implementation contract. Existing Masumi escrow identifiers may replace `escrowReference` once the payment integration is validated; do not invent a compatible contract field.

The receiver must compare these fields with stored buyer-authorized terms and current state, reject expired or superseded claims, and reject simulation reports in a deployed environment. Uniqueness constraints on `(merchantId, merchantOrderId)` and `verificationRequestId`, plus a settlement lock per escrow, block duplicate reimbursement. Replay of an already processed valid report returns the recorded result without creating a second job.

## Threat model and honest demo labels

| Threat or limitation | Minimum mitigation or disclosure |
| --- | --- |
| Filler edits screenshot or receipt | Uploads are supplementary evidence only; query a trusted merchant source. |
| Filler reuses another order's receipt | Bind merchant order, purchase reference, destination, claim, payee, amount, and escrow; enforce uniqueness. |
| Merchant API lies or merchant colludes | DON agreement on the same endpoint is not independent merchant truth. Admit merchant trust explicitly. |
| Protocol backend changes original intent | Bind evidence to signed buyer intent and confirmed escrow parameters. |
| Backend or relay signs a bad Cardano transition | The Cardano script enforces only its implemented conditions; offchain verification creates relay trust unless those conditions check the proof themselves. |
| Valid purchase cancelled after release | Unsolved by purchase proof alone; requires explicit payout timing and dispute/risk policy. |
| Duplicate callbacks or worker crashes | Durable inbox/outbox, database uniqueness, idempotency keys, and chain reconciliation. |
| API outages or inconsistent versions | Retry with bounded backoff; remain inconclusive; do not silently release. |
| Arbitrary proof URL | Fixed merchant routing and URL allowlists prevent SSRF and attacker-selected evidence sources. |
| Confidentiality | Synthetic demo data; minimize report content; no card custody in this integration. |

Display independent labels for three layers: `merchant: demo/sandbox/live`, `verifier: CRE simulation/deployed DON`, and `settlement: simulated/Cardano testnet/mainnet`. A real testnet transaction does not turn simulated verification into a deployed DON proof. A deployed DON fetching a demo merchant does not prove an Amazon purchase.

## Implementation spikes and pass evidence

1. **CRE access and version spike:** record CLI/SDK versions and lockfiles; initialize a workflow; run one HTTP fixture through simulation. If deployed access is available, record workflow ID, owner, DON/environment, and a successful execution. Capture tenant networks with `cre workflow supported-chains --output json`. Never install or assume a Cardano chain constant.
2. **Merchant adapter spike:** establish which source independently reports payment, SKU, quantity, destination and order state. Demonstrate correct order, wrong destination, wrong amount, refunded order, absent order, and unavailable API. Record unsupported fields as a blocker for that adapter.
3. **Report transport spike:** produce a report with the pinned SDK; round-trip its exact encoding; reject modified body, wrong workflow, wrong owner, wrong escrow and duplicate signer signatures. Confirm that production verification rejects simulator keys.
4. **Masumi boundary spike:** with the payment integration owner, identify the precise release authority, beneficiary, timeout and dispute state. Determine whether the report is contract-verified or only checked by the backend. A successful mock callback does not satisfy this spike.
5. **End-to-end testnet spike:** one funded order, one filler, one sandbox checkout, one valid proof, one allowed terminal transition; replay all callbacks and demonstrate no second payout. Interrupt between transaction submission and database confirmation and reconcile correctly.

Unknown until those spikes: the team's CRE deployment authorization; the chosen tenant's confidential capability access; the merchant credentials/data fields actually available; exact Masumi release authority and report integration; production cancellation/delivery protection. These are implementation gates, not claims that the project already satisfies them.
