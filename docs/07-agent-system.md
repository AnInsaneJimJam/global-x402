# Agent interaction system

This document owns the interaction model for agents and the humans supervising them. Document 04 owns its machine-readable contracts, document 02 its implementation modules, and document 06 its acceptance tests. These are design requirements, not claims that a runtime or integration already exists.

## The system an agent operates

Global Order Book is a system for turning **bounded intent into accountable commitments**. An order is not merely a row progressing through statuses: it connects a buyer's objective, a filler's objective, their independent authority, immutable commercial terms, externally observed facts and obligations that survive either agent's conversation.

The agent should always be able to answer five questions from one compact inspection:

1. What outcome am I trying to achieve, and under which accepted terms?
2. What has actually been observed, by whom, when, and in which environment?
3. What money, private data and unfinished obligations are already committed?
4. Which actions can I take, what would each do, and what blocks the others?
5. When must something happen next, and who is responsible while I am asleep?

The system must preserve uncertainty where evidence is missing. A short response that conceals an unresolved purchase is worse than a longer accurate response. Optimize successful, correctly reconciled outcomes per unit of money, time, model effort and external requests; never optimize away verification or recovery.

## Linked levels of abstraction

| Level | Agent-facing meaning | Links to the next level |
|---|---|---|
| Goal | Purchase this exact item; acquire tokens within these constraints | Local run, policy reference, candidate comparison and related orders |
| Commitment | These parties accepted this price, recipient, predicate and deadlines | Terms hash, quote, claim, scoped authority and budget reservation |
| Obligation | Someone must buy, verify, monitor, reconcile, collect or request protection | Owner, supporting facts, required capability, action and latest safe start time |
| Action | A specific bounded change with explicit consequences | Prepared plan, preconditions, actor, stable operation ID and execution owner |
| Observation | Evidence of an external or local event | Source, observation time, freshness, environment and contradiction history |
| Outcome | Verified placement and reconciled payment, or an explicit unresolved/failed result | Receipt, accounting, remaining obligations and relevant evidence references |

These are linked views over a small set of persisted records, not six new services or independently mutable state machines. Accepted terms connect every level. The same projection powers agent tools, HTTP clients and dashboard; no UI-only business logic or private agent-only bypass.

## Two primitives and a deterministic runner

The reference client exposes `inspect` and `act` as typed operations. `inspect` supports capabilities, opportunities, owned work, a local run, an order or an operation. It can request detail, a delta or a bounded wait. `act` supports a closed command catalogue with explicit preparation and commitment phases, including actor-local `start_run`, stop and resume. Named HTTP routes remain the coordinator transport; local run commands need no server route. No generic shell, arbitrary URL execution or invented payment protocol is introduced.

Use a small durable runner in each actor's own runtime to compose these primitives. The buyer runner handles one exact purchase; the filler runner handles eligible assignments toward an acquisition target. The runner is ordinary deterministic code for policies, timers, retries and reconciliation. The model resolves ambiguous intent, weighs explicitly allowed tradeoffs and explains decisions; it need not poll a chain, calculate unit prices or re-read receipts to recall progress.

The runner's local goal record contains accepted constraints, policy version, authorized capability references, budget/exposure ledger, active order and operation references, wake cursor, execution owner and last checkpoint. A goal is not unlimited delegation. MVP filler concurrency defaults to one; its policy specifies target amount, whether overshoot is allowed, maximum fiat outlay, minimum net return, latest completion time and behavior when no acceptable offers exist. Buyer goals never substitute a product or recipient silently.

A user objective becomes a durable run through `start_run`: persist its identity/constraints, report missing readiness, and enter the ordinary inspect/act loop only under existing grants. The same run ID survives a new conversation or restarted process. Do not start an independent second run merely because the model forgot the first.

## One inspection sufficient for the next decision

An inspection returns facts, authority requirements, exposure, obligations and typed next actions. A progress enum is a summary, not the sole input to a monetary decision. It distinguishes purchase placement, verification, escrow settlement and the caller's goal outcome. `PLACED_VERIFIED` does not imply payout; an operation completed successfully does not imply the goal succeeded.

Each material fact has provenance and freshness. Absence of a merchant observation means unknown or not yet observed, not proof of no purchase. Conflicting sources remain visible as a conflict until resolved. Facts from the filler's local journal are actor reports, not independent merchant proof. Freshness policy is source-specific: wall-clock expiry of a quote differs from chain confirmation/rollback evidence. Consumers never resolve contradictory economic facts merely by choosing the newest timestamp.

The coordinator provides its authorized projection; the actor runtime composes it with its private operation journal and policy into an agent view, retaining both source revisions. If the local journal is unavailable, unreconciled operations block new effects. This closes the dangerous gap where the server still shows `FUNDED` after a locally submitted checkout timed out.

Small detail levels are mandatory: a decision view by default, a reason/evidence expansion when needed, raw artifacts only by explicit authorized retrieval. Keep exact amounts, critical deadlines, modes and unknown effects in the decision view. Large receipts, histories, schemas and delivery addresses stay behind scoped references. Compact deterministic reason codes and bounded explanations replace repeated narrative histories.

## Discover once, retrieve what matters

Provide a versioned capability summary and role-specific readiness checks: supported merchant/asset/network, seller identity, signer interface, checkout authorization, proof access and monitoring capability. Each capability states whether it is configured, tested and currently available, using document 04's IntegrationIdentity to distinguish protocol, network, merchant environment and verifier execution. A documentation claim alone cannot set `tested`.

Detailed command schemas, meanings, consequences, authority, errors and recovery contracts are fetched on demand and cached by content hash. Runtime health is short-lived and fetched separately from schema descriptions. Unknown schema major versions or fields outside the understood effect/authority schema block execution. Only additions inside an explicitly informational extension namespace may be ignored; the client must not guess whether an unknown field affects money.

Generate the OpenAPI schema, typed client, compact tool descriptions and agent integration guide from the same command definitions. A future MCP adapter may expose the same interface; it is not required for the MVP and must not create different authorization or business logic. Integration requires a supported wallet/merchant adapter, not a specific LLM vendor.

## Prepare, authorize, commit, observe

Preparation is an exact preview, not a spending effect or a reservation. It can validate/read state and persist an expiring plan, but cannot sign a spending transaction, fund, claim an order, purchase, reveal newly restricted data or incur a new user-paid service charge. Plans list destination, asset, amount and worst-case authorized fees; private-data disclosures; required signers; native waiting periods; success evidence; and failure/recovery semantics. Unknown monetary upper bounds prevent automatic commitment.

Protocol-required quote authentication is distinct from spending authorization. Preparation may obtain a seller-signed offer only within an already accepted claim and its existing bounded quote-issuance authority. Persist every issued offer/validity interval for withdrawal reconciliation; issuance must stop when the claim is withdrawing. Preparation cannot create a new seller commitment, change agreed terms or obtain a buyer spending signature. If the selected SDK cannot preserve these semantics, expose that as an integration blocker rather than hide a side effect in a preview.

Commitment rechecks actor authorization, accepted terms, decision-relevant versions, eligibility, live deadline bounds and atomically reserved budgets. A stale plan returns a precise conflict and a refreshed inspection without creating a new external effect. An available action is guidance, never a bearer permission; knowing a plan ID, task ID or wallet address grants nothing.

Routine commits inside an existing valid user policy run automatically. Human attention is required only for a missing consequential choice, new authority or an external challenge such as MFA. The system explains the exact missing input and resumes the same operation after resolution. It does not ask the user to approve every network retry or force the model to reproduce a complete order.

For x402 funding, the preparation and receipt wrap the actual standard challenge/signature/settlement exchange. The existing scheme determines payment wire formats. The actor signer independently validates the bound terms and transaction effects, not merely the backend's human-readable preview. A committed payment pending confirmation is not eligible checkout funding.

For merchant checkout, the filler runtime owns preparation, credentials and the irreversible call. It records a purchase attempt with the coordinator before invoking checkout and journals the operation locally before submission. The coordinator's registration acknowledges an obligation, not an independently proven purchase. If either journal or acknowledgement fails, do not start checkout. Merchant-origin observation still determines proof.

## Durable operations, bounded recovery

Persist the business operation ID and canonical effect before external submission. An HTTP idempotency key is a transport aid; losing it must not make the same business effect new. An identical retry returns the existing receipt; conflicting arguments under the same ID are rejected. A receipt says what its own named operation achieved, which actor owns it, what remains unknown and how to observe/reconcile it.

Lost responses lead to `OUTCOME_UNKNOWN` or `PENDING`, never permission to start a replacement payment or purchase. After a crash, reconcile owned nonterminal operations before offering new spending actions. A checkout is retried only with documented merchant idempotency or definitive evidence of no purchase. If neither is possible, require a narrow intervention and expose the outstanding exposure. This system does not promise universal exactly-once external effects.

One funded assignment permits at most one successful merchant purchase. A known `ORDERED` attempt blocks all new checkout operations for that assignment even before evidence has been submitted; the next step is evidence/verification. Only definitively unsuccessful attempts with no purchase may be replaced. Changing an operation ID never resets this business invariant.

Use one active executor per actor/run and fence its coordinator writes with an execution epoch. A replacement executor acknowledges ownership and obtains authorization independently; it reconciles old operations before issuing new effects. Leases cannot cancel a transaction already signed or fence an arbitrary external merchant. Do not permit a takeover to repeat a purchase whose previous executor may still be completing it.

Handoff exports only goal/policy identifiers, orders, operation IDs, evidence references, cursors and outstanding obligations—no credentials, raw address or model conversation. The recipient must be authorized to read linked private state. The previous monitor relinquishes ownership only after the replacement acknowledges coverage; otherwise the handoff remains incomplete. MVP needs restart recovery within one actor runtime; cross-device handoff can wait, but must use this contract when added.

## Deadlines and monitoring are obligations

Every funded order has a named monitor and a visible health/last-check record. The buyer's actor runtime owns protection actions that require buyer authority. The operator can notify and observe; it must not imply it can sign a refund request without the required delegation. Before funding, readiness checks establish a functioning monitor and sufficient signing/network budget for protective actions. Expose remaining outage and signer-availability risk; no application health badge changes the native contract.

For each deadline show the source, absolute time, who must act, and a conservative `safeActBy` accounting for adapter-measured submission/confirmation allowance and clock skew. Do not invent a universal minute buffer. If the time budget is already insufficient, block new exposure and raise the applicable protection/intervention immediately.

Waiting uses event cursors or bounded conditional reads scheduled by the deterministic runner. Wake the model for a new decision, contradiction, required authority, urgent protection or a terminal outcome. Ordinary unchanged blocks and successful worker retries do not consume a model turn. Resource backoff is capped by the nearest safety deadline. Lost/expired cursors trigger a new consistent snapshot plus obligation scan, never silent event loss.

`stop_new_commitments` stops fresh orders, claims, payments and purchases. It does not claim to cancel a merchant order, undo an unknown effect or retrieve locked funds. Existing monitoring/reconciliation and authorized protective actions continue. A hard process shutdown must expose uncovered obligations and their deadlines; secrets revocation may prevent automatic protection and must be visible.

Release an unfunded claim on stop only after proving no pending/valid funding attempt can still attach to it. A funded assignment without purchase moves to its tested refund/protection process rather than disappearing. Existing settlement collection and refund actions may continue under valid grants because they resolve already accepted obligations; they are not new purchase commitments. If a grant or budget prevents resolution, identify the actor and intervention needed.

The filler runner sends a durable claim-withdrawal request before considering a reserved assignment stopped. The coordinator blocks fresh funding terms immediately, retains any outstanding valid/pending payment liability and acknowledges eventual release or funded recovery. A local stop flag alone cannot make a published filler claim unavailable to a buyer's agent.

## Optimization the agent can audit

Opportunity selection is deterministic under explicit policy: filter hard constraints first; compare net proceeds, fiat cost, external fees, eligible asset and settlement delay next; break ties with a documented stable rule. Report the actual candidate set/coverage, observation timestamps, exclusions and calculation. If fees or FX values are unknown, show the missing inputs rather than declaring the offer profitable. Never convert a supported-offer comparison into a claim of best worldwide price.

Budget three resources separately: financial exposure, external calls/work and model context. Retain independent fiat and token units; estimates are labeled, lower/upper bounds separate from realized amounts. Cap retries and proof refreshes, deduplicate identical evidence jobs, batch eligible reads, cache stable schemas and wait without LLM inference. Protective duties remain visible when a resource allowance is exhausted; no silent fail-open or stop-monitoring behavior.

Measure task success, false approvals, duplicated effects, recovery success and obligation coverage before optimizing request counts. Document 06 defines trace-based cost measurements and initial budgets; they are engineering targets, not achieved benchmarks.

## Accretive capability without untrusted policy changes

Make successful work reusable as small verified artifacts: normalized merchant field mappings, replayable failure fixtures, capability conformance traces, stable error remedies and agent guide examples. Key them by merchant/adapter/protocol/predicate version and environment. Record source, date, applicability, expiry and a redacted evidence reference. Promotion follows `OBSERVED → REVIEWED → TESTED → ENABLED`; incompatible versions invalidate applicability.

Keep operational knowledge separate from user authority and transaction evidence. A remembered workaround cannot raise a budget, change a recipient, weaken a proof predicate, elevate a mock to live or grant a signer permission. New merchant behavior is a candidate for review and tests, not a self-modifying payment policy. Corrections are versioned and reversible. Do not build a cross-user memory service or publish private order traces in the MVP; a small versioned adapter conformance catalogue and regression fixtures are sufficient.

Orders retain their accepted predicate/terms versions. A new default applies to future commitments; it does not reinterpret an already funded purchase. A security revocation may block unsafe execution and create a visible recovery/intervention obligation, but it cannot silently replace the buyer's agreement.

## Interface decision and limits

Three designs were compared: minimal inspect/act primitives, a broadly extensible capability interface, and a task-oriented runtime. The selected combination uses the small primitives for caller leverage, a generated static catalogue for extension, and a deterministic actor runner for the common case. Authority and unknown outcomes remain explicit at every level.

The module earns its depth by absorbing sequencing, durable receipts, normalized observations and recovery across clients. It must not merely rename REST routes, conceal unsupported protocol actions or centralize every actor's credentials. Start with one merchant, one actual payment mode and its test adapter. Defer a plugin engine, workflow language, hosted autonomous planner, vector memory and additional queues until a demonstrated requirement exists.
