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
| T33 | New agent begins without prior chat history | Typed start_run → inspect(run) → stop/resume works from compact role guide; repeated start preserves identity; control view identifies terms, exposure, authority and obligations |
| T34 | Server still shows FUNDED after local checkout timeout | Unknown registered/local purchase operation blocks new checkout; fresh runtime reconciles instead of buying twice |
| T35 | Valid plan is committed after claim, terms, evidence or authority changes | Relevant version/binding rejection before new effects; refreshed reason and control reference returned |
| T36 | Irrelevant heartbeat arrives, or time expires without a new event | Heartbeat alone need not invalidate plan; real clock expiry still blocks stale commitment |
| T37 | Caller knows another actor's plan/task/operation ID | Access and authority checks prevent reading private detail or executing an action |
| T38 | Action is AVAILABLE but signing grant is absent/revoked | Explicit authority blocker; availability never becomes signing permission |
| T39 | Preparation is repeated | No new claim, budget reservation, spending signature, purchase, restricted disclosure or user-paid charge; any seller quote issuance stays within existing authority and is durably tracked |
| T40 | Same business operation is retried after HTTP-key expiry | Existing durable receipt/effect is reused; changed arguments produce conflict |
| T41 | Model is idle during unchanged native waiting period | Deterministic monitor runs and deadlines remain covered with zero model invocations |
| T42 | Event duplicate, missing event or expired cursor | Deduplication or full snapshot/obligation recovery; no missed protection obligation |
| T43 | User stops a funded run or acquisition target is reached | No new commitments; existing reconciliation/protection continues within authority and remaining exposure stays visible |
| T44 | Active executor fails or is replaced during checkout | Old coordinator writes fenced; unresolved external call reconciled before replacement effect; no exactly-once claim based on lease alone |
| T45 | Monitor unhealthy or signer unavailable near deadline | Exact owner, health and safeActBy visible; new exposure blocked and intervention raised; no fabricated automatic refund |
| T46 | Merchant and actor observations disagree | Provenance and contradiction retained; newest timestamp alone cannot authorize payout |
| T47 | Duplicate verification job, then new cancellation observation | Reuse valid identical result; invalidate freshness/context on new contradictory data |
| T48 | Cached capability uses wrong major schema or untested adapter version | Automatic money action blocked; precise refresh/retest requirement |
| T49 | Learned remedy says to weaken proof or raise budget | Advisory knowledge cannot change authority or predicate; rejected promotion and regression fixture |
| T50 | Local journal is missing/corrupt/unreachable | Readiness fails for new effects; recover registered operations rather than initialize an apparently empty wallet task |
| T51 | Concurrent claims plus pending/unknown proceeds would overshoot target, or fee estimate is missing | Atomic target-capacity reservation includes expected unsettled proceeds; unknown outcomes retain reservations; unknown economics cannot be ranked as guaranteed profit |
| T52 | UI, HTTP client and agent tool perform the same command | Same domain handler and authorization/consequence semantics; generated schema drift check passes |
| T53 | Session loses access while effect is pending | Receipt remains durably recoverable by reauthorized owner; authentication failure is not classified as failed payment |
| T54 | Provider-call/resource budget exhausted | No silent approval or hidden stop-monitoring; outstanding duty and required intervention remain visible without unauthorized spend |
| T55 | Purchase reached ORDERED but evidence was not submitted; new operation ID tries again | Coordinator and local runner reject the second purchase atomically; recovery submits existing order evidence |
| T56 | Filler stop/withdrawal races with buyer funding | Fresh funding terms blocked; earlier valid/pending payments reconciled; no unsafe claim release or invisible funded liability |
| T57 | Merchant sandbox, simulated CRE and actual Preprod escrow combined | Separate IntegrationIdentity fields represent each layer; no one live label upgrades the others |
| T58 | Actor-local plan is substituted for coordinator admission, or transaction differs from prepared effect | Correct plan owner/binding required; signer independently checks actual effects and refuses the mismatch |

For T17, inability to enforce the merchant predicate on-chain is a material trust limitation even if the monitor works. Record the maximum monitored response delay and compare it with remaining native deadlines. Mainnet readiness is not inferred from one successful testnet run.

## Agent ergonomics and resource acceptance

Test the module through the same inspect/act interface used by agents. In-process policy tests validate math and eligibility; database-backed tests validate claims, operations, budget reservations and outbox recovery; scripted external adapters inject ambiguity and failures. Native/merchant conformance traces establish real capabilities separately. A mock PASS is not permission to label an integration live.

Use deterministic fixtures and a controlled clock for the following initial engineering targets. Record measured results; these targets have not been achieved by this planning work.

| Measurement | Target and test method |
|---|---|
| Onboarding context | Role quickstart at most 6 KiB UTF-8, excluding schemas retrieved on demand. New caller completes correct fixture using guide plus tool contracts, without reading the entire planning pack. |
| Default per-order decision view | At most 8 KiB UTF-8 serialized JSON in ordinary fixtures, preserving all money, authority, uncertainty and imminent obligation fields. Fetch large evidence separately. |
| Overflow correctness | Never silently truncate obligations to meet size target. Return explicit overflow/continuation and bounded summary; deterministic monitor scans every page. Urgent obligations remain prioritized and visible. |
| Fresh-session recovery | Single-order interrupted fixture recovers next safe action in at most three coordinator reads plus local journal loading; zero dependence on previous model messages. Measure extra external reconciliation reads separately. |
| Idle model cost | Zero model invocations in a 15-minute unchanged waiting fixture; one model notification per meaningful decision/intervention/outcome, deduplicated by event/obligation identity. Native on-chain time is never accelerated in claims. |
| Provider work | No chain/merchant/CRE request caused solely by rereading an unchanged control view. Observation workers honor source freshness/deadline budgets; duplicate evidence jobs do not repeat work within valid cache bounds. |
| Financial correctness | Zero duplicate purchases/payouts, false proof approvals or unauthorized effects across the scripted fault suite; unresolved cases are exposed, not counted as successes. |
| Explainability | For each decision, caller identifies accepted terms, decisive fact references, exact permitted effect and reason without downloading raw history. No private reasoning transcript required. |
| Context and call accounting | Report model input/output tokens when available, UTF-8 bytes, schema cache hits, model invocations, coordinator/provider/CRE calls, retries, deadline coverage and time to outcome per scenario. |

Optimize against a measured straightforward polling client using the same fixture, conditions and correctness checks; do not invent savings percentages. Reduced resource use is a win only when recovery, safety and outcome quality remain intact. Any regression in missed obligations, ambiguous-effect handling or false approvals blocks the optimization.

## Required walkthrough traces

Maintain redacted, machine-replayable fixtures for: successful buyer/filler placement, no acceptable filler opportunity, vanished filler recovery, unknown merchant purchase after restart, price change after funding, invalid proof, unauthorized seller result, source outage near dispute deadline, stopped run with pending funds and recovered event-cursor loss. Each trace records commands, plans, effects, observations, receipts, obligations, wakeups and expected caller view.

Use one schema source for runtime validators, OpenAPI, typed clients and compact tool descriptions. Verify field meanings and error recovery remain identical across all generated artifacts. Keep conformance evidence/version data separate from static schema generation so a new SDK build cannot accidentally mark an untested adapter operational.

## Demo narrative

1. Show network, actual asset, escrow mode, merchant mode, CRE mode and payout condition on the first screen.
2. Buyer instructs the reference agent to buy the configured Coke SKU, quantity one, delivered to a synthetic address. Show agent budget enforcement and a fee-transparent quote.
3. Filler tells its agent to acquire tokens within a fiat budget. The agent compares available offers, explains the expected net benefit, claims a suitable order and waits for actual funding. Explain the selected match-before-lock sequence and direct filler escrow recipient.
4. Show the escrow transaction and fixed recipient. Filler proceeds only after confirmation.
5. Filler agent completes the selected familiar merchant/platform's authorized checkout and submits an order reference. Show independent merchant lookup and real CRE execution in the available mode. Label official sandbox purchases accurately; use a custom demo merchant only if that last-resort fallback was chosen.
6. Show predicate comparison and the bound result. Display native dispute/collection timing instead of claiming instantaneous release.
7. Show the final confirmed filler receipt and economics using a completed earlier run if necessary. Label prerecorded evidence with timestamps and keep its IDs separate from the live order.
8. Show one bad-proof rejection and a previously completed refund with its chain evidence.
9. Restart the filler agent after a deliberately ambiguous checkout response. Show that the durable operation/control view leads it to reconciliation without another purchase or access to its old chat history.
10. Show a no-change wait without model calls, followed by a single meaningful wake-up. Inspect a prepared effect and its authority, then stop new commitments while displaying any remaining obligations.

Never accelerate on-chain deadlines by changing the UI clock. Local accelerated tests are labeled simulations. If x402 lifecycle fails and D7 selects native Masumi, state explicitly that x402 purchase funding remains incomplete.

## Required demo artifacts

- Integration manifest with network, actual asset identifiers, deployment/version hashes, observed fees, deadlines and confirmation policy.
- Redacted quote, order/claim/escrow IDs, transaction links for lock, result, payout and refund.
- CRE source, invocation instructions, execution output, report verification evidence and live/simulation label.
- Merchant fixture/API source and a description of who controls the data.
- End-to-end runbook, required environment variable names without values, and clean setup instructions.
- Test report listing actual commands and PASS/FAIL/BLOCKED evidence, plus unresolved limitations.
- Generated role guide, capability schemas, control-view examples and agent ergonomics/resource measurements.
- Redacted interruption/recovery trace and adapter conformance catalogue with version, environment and promotion evidence.

## Claims supported by the proposed demo

“An external agent can commission a purchase through an escrow-backed filler marketplace on Cardano, with a verified merchant API workflow and explicit settlement conditions.”

Only strengthen that claim to x402-funded escrow after G1/G3 pass. Only claim deployed Chainlink verification after actual DON execution and report validation. Do not claim universal Amazon verification, guaranteed physical delivery, zero trust, instant payouts, native USDC on Cardano, or guaranteed profit after fees.
