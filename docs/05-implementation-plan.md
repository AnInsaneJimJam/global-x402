# Implementation plan

This is a future execution plan. The current user request ends at the reviewed design/documentation handoff; do not start these implementation milestones as part of that request.

## Execution rule

Build a small vertical slice first. The highest-risk dependency is the real funding-to-settlement lifecycle, followed by authorized automated merchant checkout and authoritative evidence. A finished dashboard does not resolve these. The hackathon scope, two-agent workflow, initial test tokens, familiar-merchant priority, flexible schedule, architecture A and order-placement completion are confirmed. D5 needs a tested platform selection, D2 needs its exact merchant payment-state mapping, and D7 applies if the target protocol path fails.

Build the agent interaction contract alongside those feasibility checks. Its core is the shared control view and operation/obligation model in [document 07](07-agent-system.md), not a collection of independent LLM wrappers. UI, reference clients and future tool transports must consume the same domain interface. The implementing agent reads the architecture and only the branch-specific adapter research needed for its current milestone; it need not reload all research for every edit.

The stack/layout below is proposed for a new repository, not a statement that these directories already exist:

```text
apps/web                 filler and operator interface
apps/api                 public HTTP API and order service
apps/worker              reconciliation, outbox, lifecycle requests
packages/contracts      shared application schemas (not a blockchain contract)
packages/procurement    domain commands, control views and obligations
packages/agent-runtime actor-local runner, journal, policies and continuation
packages/payments       x402/Masumi adapters and signer interfaces
packages/merchants      chosen familiar platform checkout/evidence adapters
packages/policy         deterministic buyer and evidence checks
workflows/verify-order  CRE workflow
examples/buyer-agent    reference autonomous buyer client
examples/filler-agent   acquisition policy, checkout and fulfillment agent
fixtures                synthetic merchant/proof scenarios
docs                    this planning pack and integration evidence
```

Directories are logical module ownership, not a requirement to publish many packages. Start with workspace modules in the existing processes. Protocol, merchant and actor authority are real seams; avoid scaffolding a service per data type.

## Milestone 0 — Fix scope and name candidate integrations

Preserve selected architecture A and the placement-based MVP scope. Name candidate merchant checkout/evidence sources, payment tooling and test assets, along with known access prerequisites. Plan provisioned fillers whose seller identities will be ready before claims. Record which predicate mappings, refund behavior and fees remain hypotheses for Milestone 1. Update every affected document when a candidate is accepted or rejected.

**Done:** selected product semantics and candidate integration questions are explicit enough to run the spikes. This milestone does not require their results in advance. The precise merchant predicate, actual refund path and externally feasible implementation are frozen only after Milestone 1's evidence; no money flow is accepted as ready before then.

## Milestone 1 — Prove dependencies and the agent control contract

Perform these spikes before substantial frontend work:

**1A. Payment/lifecycle.** Pin official Cardano x402 package/spec and Masumi validator revisions. Provision test identities and funds. Demonstrate x402 lock, exact beneficiary, result submission, collection, buyer-requested refund, no-result expiry, and process-restart reconciliation. The known SDK/Node authorization mismatch must be solved with tested lifecycle tooling, not hidden behind a common interface. Capture signer roles, datum changes, tx hashes, fee amounts and actual durations. Test a seller attempting result submission without application approval. Record whether CRE/policy is an enforceable contract condition or only off-chain policy.

If the x402-aware lifecycle cannot be completed in the allotted spike, present D7 with evidence. An agreed native MIP-003 fallback must pass its own full lifecycle. A funding-only demo is incomplete, not an escrow MVP.

**1B. Familiar merchant and checkout.** Use [merchant options](research/merchant-options.md) to investigate Amazon Business and other common platforms such as eBay, prioritizing authorized usable access rather than brand preference alone. Demonstrate both the filler agent's checkout and an authoritative order lookup with payment status, recipient, buyer/filler binding, timestamp, cancellation and order reference. Record permissions, sandbox/live mode, authentication challenges and missing fields. A developer API listing is not access approval. If common-platform routes fail, document why and ask before adopting a custom demo merchant as last resort. Whichever source is chosen, keep filler-write input separate from merchant records so the filler cannot manufacture approval.

**1C. CRE.** Install supported tooling, inspect actual deployment access, implement one deterministic check, simulate real API retrieval and persist the resulting evidence. Test actual deployed report verification separately if available. Establish Cardano relay authority and simulation-only separation. If deployed access is unavailable, use the agreed local simulation label throughout the demo.

**1D. Quote.** Measure protocol deductions and all ADA/minimum-output costs from the chosen lifecycle. Construct a quote that delivers the declared filler net amount and explains subsidies. Capture the asset policy/name/decimals from authoritative network data.

**1E. Control contract.** Define typed commands, immutable accepted terms, prepared effects, operation receipts and role-filtered control views. Write scripted traces for happy purchase, vanished filler, unknown checkout, unauthorized seller result and a stopped runner with outstanding escrow. Use a controllable clock and actor-local journal plus a locally running database. Drive the traces through the same inspect/act interface used by clients; fail if a fresh caller must infer monetary facts from old chat text. Generate the initial capability schemas and role guide from these definitions. Label fixture capabilities as test-only; passing them is not protocol proof.

**Done:** select the actually usable merchant/payment path and exact placement predicate; update the decision register and write `docs/integration-manifest.md`, control-contract fixtures and redacted transaction/report evidence. G1–G6 either pass with reproducible artifacts or trigger an explicit scope revision; 1E establishes an executable interface baseline for G7. No-result recovery must have actual pass evidence before accepting the money flow. Investigate these dependencies sequentially or with available independent builders; no fixed deadline was supplied and no arbitrary calendar cutoff is imposed.

## Milestone 2 — Order service and recovery skeleton

Implement schemas, migrations, wallet auth, quote persistence, redacted listing, atomic claims, idempotent funding requests, durable terms/settlement stores, outbox jobs and the chain observer. Implement deadline-aware ownership of claims and pending transactions. Add a seeded buyer and two filler identities for concurrency tests. Keep private recipient data out of public responses.

Implement coordinator operation/obligation records and actor-local run journals before autonomous spending. Add prepared-action validation, durable purchase-attempt registration, execution epochs, `/work` recovery, conditional control reads and cursor-based waits. Keep policy/ranking in deterministic code. Capability health and integration modes must come from actual adapter readiness, not UI defaults. Start with one shared runner implementation instantiated separately for buyer and filler; do not add a hosted LLM orchestration service.

**Done:** two filler claims produce one assignment; duplicate requests produce one funding operation; pending transactions survive restart; only matching confirmed funding reveals the assignment and authorizes purchase; an expired reservation with a pending tx cannot be reassigned unsafely. Freshly restarted actors recover open obligations and uncertain checkout without old conversation context; stale plans and unauthorized actions cannot create effects.

## Milestone 3 — One complete purchase

Wire the reference buyer agent to policy, matching and funding. Implement the filler reference agent's acquisition goal, opportunity comparison, fiat guardrails, claim, funding readiness, authorized checkout, evidence submission and restart-safe purchase reconciliation. Use the dashboard to observe these actions. Implement merchant lookup, CRE predicate execution, result authentication and authorized native lifecycle actions. Reconcile final recipient balance/transaction.

**Done:** after initial authorization, the buyer's purchase request and filler's acquisition request drive an end-to-end purchase on the chosen testnet with actual escrow transactions and an accurately labeled merchant/CRE mode. The filler agent explains why it selected the offer, stays within fiat limits and avoids duplicate purchases. Receipt acceptance, result submission and final payout appear as distinct milestones. A screenshot alone cannot cause payout. Any manual checkout intervention is disclosed as an automation limitation.

Drive the demonstration from the compact role guide and generated contracts. The default decision view must explain the next safe action without fetching every raw artifact. Record model invocations, context bytes, coordinator/provider calls, retries, time waiting and actual fee accounting. An unchanged waiting period should run without model calls.

## Milestone 4 — Failure paths and buyer protection

Implement invalid/inconclusive evidence, corrected submissions, source outage, funded inactivity, refund requests, actual dispute mapping, late funding, replay rejection and observer recovery. Buyer monitor detects unauthorized result submission and requests the available protection before the deadline. Add operational alerts and a manual review queue without granting fictional chain authority.

Exercise monitor liveness, authority expiry, stale capability/version handling, event gaps, conflicting observations and local-state loss. `stop_new_commitments` must preserve open protection duties and unknown effects. Test executor replacement with an in-flight merchant request; database fencing alone cannot prove the external request did not complete. Record recovered failures as redacted versioned adapter fixtures; promotion to usable capability requires review and conformance tests.

**Done:** relevant cases in document 06 pass; every nonterminal order has an owner, next action and deadline. Refund UI is backed by a confirmed refund transaction or explicitly shows a pending/unavailable action.

## Milestone 5 — Usability, documentation and demonstration

Refine the filler dashboard around Available, Reserved, Funding, Purchase, Verifying and Settlement. Show amounts/asset/network, fee breakdown, private recipient access, evidence reason codes and pending timers clearly. Add buyer integration examples, discovery through verified Masumi registration if available, setup/run instructions and a recorded demonstration of actual slow settlement.

Render the shared control view, obligations and action plans directly rather than recreating business logic in components. Generate typed clients, tool descriptions and role guides from one schema source; run a drift check. Publish an adapter conformance catalogue with environment/version, verified behaviors, limitations and evidence links. Include resume and failed-operation examples in the onboarding path. Cross-device handoff, MCP packaging and broad extension discovery remain optional later work.

**Done:** a fresh environment follows the runbook; secrets remain uncommitted; capability labels agree with reality; transaction links and verification artifacts are accessible; demo covers payout, refund and fresh-session recovery. G7 and the resource targets in document 06 have measured results, with any misses disclosed. No production deployment or real purchase is implied by completing the testnet scope.

## Conditional parallel work

If multiple builders are available, payment spikes, merchant evidence and CRE research can run independently against agreed fixture schemas. Keep one owner for shared schemas and state machine. After Milestone 1, UI and API can proceed in parallel against frozen contracts. Contract architecture and integration decisions remain centrally owned; separate builders must not independently choose incompatible trust models.

## Prioritization when time is short

Keep: buyer and filler reference agents, one supported automated merchant checkout, real escrow lifecycle, credible evidence retrieval, real CRE execution in the available mode, fees, refund path and honest labels.

Cut first: native mobile download, arbitrary browser automation, multi-merchant support, card vaults, reputation, analytics, auctions, insurance, custom blockchain contracts, generic agent-framework integrations and visual polish beyond basic usability.

Do not cut refund/recovery validation to make room for another screen. Do not substitute mock completion for an unresolved external dependency without marking the outcome as partial and revising the demo claims.
