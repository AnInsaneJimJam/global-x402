# Implementation plan

## Execution rule

Build a small vertical slice first. The highest-risk dependency is the real funding-to-settlement lifecycle, followed by authorized automated merchant checkout and authoritative evidence. A finished dashboard does not resolve these. The hackathon scope, two-agent workflow, initial test tokens, familiar-merchant priority, flexible schedule, architecture A and order-placement completion are confirmed. D5 needs a tested platform selection, D2 needs its exact merchant payment-state mapping, and D7 applies if the target protocol path fails.

The stack/layout below is proposed for a new repository, not a statement that these directories already exist:

```text
apps/web                 filler and operator interface
apps/api                 public HTTP API and order service
apps/worker              reconciliation, outbox, lifecycle requests
packages/contracts      shared application schemas (not a blockchain contract)
packages/payments       x402/Masumi adapters and signer interfaces
packages/merchants      chosen familiar platform checkout/evidence adapters
packages/policy         deterministic buyer and evidence checks
workflows/verify-order  CRE workflow
examples/buyer-agent    reference autonomous buyer client
examples/filler-agent   acquisition policy, checkout and fulfillment agent
fixtures                synthetic merchant/proof scenarios
docs                    this planning pack and integration evidence
```

## Milestone 0 — Freeze a coherent MVP

Preserve selected architecture A. Resolve the precise merchant order-placement predicate and one merchant checkout/evidence source. Use provisioned fillers whose seller identities are ready before claims. Select testnet asset naming and presentation. Update every affected document, not just the decision register. Exercise the no-result recovery path before accepting the money flow as complete.

**Done:** the founder can describe when money locks, who can receive it, what fact earns payout, what happens on cancellation, and what demo elements are simulated. No unresolved product choice affects the first end-to-end slice.

## Milestone 1 — Prove the dependencies

Perform these spikes before substantial frontend work:

**1A. Payment/lifecycle.** Pin official Cardano x402 package/spec and Masumi validator revisions. Provision test identities and funds. Demonstrate x402 lock, exact beneficiary, result submission, collection, buyer-requested refund, no-result expiry, and process-restart reconciliation. The known SDK/Node authorization mismatch must be solved with tested lifecycle tooling, not hidden behind a common interface. Capture signer roles, datum changes, tx hashes, fee amounts and actual durations. Test a seller attempting result submission without application approval. Record whether CRE/policy is an enforceable contract condition or only off-chain policy.

If the x402-aware lifecycle cannot be completed in the allotted spike, present D7 with evidence. An agreed native MIP-003 fallback must pass its own full lifecycle. A funding-only demo is incomplete, not an escrow MVP.

**1B. Familiar merchant and checkout.** Use [merchant options](research/merchant-options.md) to investigate Amazon Business and other common platforms such as eBay, prioritizing authorized usable access rather than brand preference alone. Demonstrate both the filler agent's checkout and an authoritative order lookup with payment status, recipient, buyer/filler binding, timestamp, cancellation and order reference. Record permissions, sandbox/live mode, authentication challenges and missing fields. A developer API listing is not access approval. If common-platform routes fail, document why and ask before adopting a custom demo merchant as last resort. Whichever source is chosen, keep filler-write input separate from merchant records so the filler cannot manufacture approval.

**1C. CRE.** Install supported tooling, inspect actual deployment access, implement one deterministic check, simulate real API retrieval and persist the resulting evidence. Test actual deployed report verification separately if available. Establish Cardano relay authority and simulation-only separation. If deployed access is unavailable, use the agreed local simulation label throughout the demo.

**1D. Quote.** Measure protocol deductions and all ADA/minimum-output costs from the chosen lifecycle. Construct a quote that delivers the declared filler net amount and explains subsidies. Capture the asset policy/name/decimals from authoritative network data.

**Done:** write `docs/integration-manifest.md` and redacted transaction/report evidence. G1–G6 either pass with reproducible artifacts or trigger an explicit scope revision. Investigate these dependencies sequentially or with available independent builders; no fixed deadline was supplied and no arbitrary calendar cutoff is imposed.

## Milestone 2 — Order service and recovery skeleton

Implement schemas, migrations, wallet auth, quote persistence, redacted listing, atomic claims, idempotent funding requests, durable terms/settlement stores, outbox jobs and the chain observer. Implement deadline-aware ownership of claims and pending transactions. Add a seeded buyer and two filler identities for concurrency tests. Keep private recipient data out of public responses.

**Done:** two filler claims produce one assignment; duplicate requests produce one funding operation; pending transactions survive restart; only matching confirmed funding reveals the assignment and authorizes purchase; an expired reservation with a pending tx cannot be reassigned unsafely.

## Milestone 3 — One complete purchase

Wire the reference buyer agent to policy, matching and funding. Implement the filler reference agent's acquisition goal, opportunity comparison, fiat guardrails, claim, funding readiness, authorized checkout, evidence submission and restart-safe purchase reconciliation. Use the dashboard to observe these actions. Implement merchant lookup, CRE predicate execution, result authentication and authorized native lifecycle actions. Reconcile final recipient balance/transaction.

**Done:** after initial authorization, the buyer's purchase request and filler's acquisition request drive an end-to-end purchase on the chosen testnet with actual escrow transactions and an accurately labeled merchant/CRE mode. The filler agent explains why it selected the offer, stays within fiat limits and avoids duplicate purchases. Receipt acceptance, result submission and final payout appear as distinct milestones. A screenshot alone cannot cause payout. Any manual checkout intervention is disclosed as an automation limitation.

## Milestone 4 — Failure paths and buyer protection

Implement invalid/inconclusive evidence, corrected submissions, source outage, funded inactivity, refund requests, actual dispute mapping, late funding, replay rejection and observer recovery. Buyer monitor detects unauthorized result submission and requests the available protection before the deadline. Add operational alerts and a manual review queue without granting fictional chain authority.

**Done:** relevant cases in document 06 pass; every nonterminal order has an owner, next action and deadline. Refund UI is backed by a confirmed refund transaction or explicitly shows a pending/unavailable action.

## Milestone 5 — Usability, documentation and demonstration

Refine the filler dashboard around Available, Reserved, Funding, Purchase, Verifying and Settlement. Show amounts/asset/network, fee breakdown, private recipient access, evidence reason codes and pending timers clearly. Add buyer integration examples, discovery through verified Masumi registration if available, setup/run instructions and a recorded demonstration of actual slow settlement.

**Done:** a fresh environment follows the runbook; secrets remain uncommitted; capability labels agree with reality; transaction links and verification artifacts are accessible; demo covers payout and refund. No production deployment or real purchase is implied by completing the testnet scope.

## Conditional parallel work

If multiple builders are available, payment spikes, merchant evidence and CRE research can run independently against agreed fixture schemas. Keep one owner for shared schemas and state machine. After Milestone 1, UI and API can proceed in parallel against frozen contracts. Contract architecture and integration decisions remain centrally owned; separate builders must not independently choose incompatible trust models.

## Prioritization when time is short

Keep: buyer and filler reference agents, one supported automated merchant checkout, real escrow lifecycle, credible evidence retrieval, real CRE execution in the available mode, fees, refund path and honest labels.

Cut first: native mobile download, arbitrary browser automation, multi-merchant support, card vaults, reputation, analytics, auctions, insurance, custom blockchain contracts, generic agent-framework integrations and visual polish beyond basic usability.

Do not cut refund/recovery validation to make room for another screen. Do not substitute mock completion for an unresolved external dependency without marking the outcome as partial and revising the demo claims.
