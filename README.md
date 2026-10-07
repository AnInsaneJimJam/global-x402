# Global Order Book — implementation planning pack

**Status: architecture A and order-placement completion confirmed; merchant selection and integration spikes remain.**

Prepared 7 October 2026. This repository currently contains planning documents, not an implemented application. The original diagram is preserved at [docs/assets/original-architecture.png](docs/assets/original-architecture.png).

Global Order Book lets a buyer's AI agent commission a Web2 purchase, reserve payment in Cardano escrow, and pay a filler who purchases using their own fiat. The filler earns an explicitly quoted reward. Verification connects the merchant's evidence to the escrow lifecycle.

**Selected flow (A):** buyer posts intent → filler agent accepts → buyer agent funds escrow naming that filler → filler agent purchases → verify order placement → settle under the contract's rules. The platform coordinates the order without first collecting the escrow proceeds. A tested refund/recovery path for a filler who never places the order is required.

The confirmed goal is a hackathon MVP with **both buyer and filler agents acting autonomously**: the buyer requests a purchase, while the filler requests a favorable stablecoin acquisition opportunity. Test tokens are acceptable before a later real stablecoin integration. The first slice proposes one item, one familiar merchant/platform, one currency, and one filler per order. **Order-placement verification is the confirmed MVP completion condition.** Delivery failures after payout are outside MVP protection; delivery verification is a longer-term target. A custom demo merchant is a last resort.

## Reading order

1. [Decisions and readiness](docs/00-decisions.md): open product choices, protocol gates, and what can be implemented now.
2. [Product specification](docs/01-product-spec.md): roles, workflow, economics, screens, and scope.
3. [Architecture](docs/02-architecture.md): components, trust boundaries, escrow alternatives, and lifecycle.
4. [Proof and settlement](docs/03-proof-and-settlement.md): evidence policy, CRE's role, disputes, and security.
5. [API and data contracts](docs/04-api-and-data.md): proposed application interfaces and persistence model.
6. [Implementation plan](docs/05-implementation-plan.md): ordered milestones with acceptance criteria.
7. [Tests and demo](docs/06-tests-and-demo.md): observable correctness and demo requirements.
8. [Masumi/x402 research](docs/research/masumi-x402.md) and [CRE/proof research](docs/research/cre-proof.md): primary-source findings and integration limitations.
9. [Merchant options](docs/research/merchant-options.md): familiar platforms, access prerequisites, and autonomous checkout/evidence feasibility.

## Instructions for the implementing agent

Read documents 00–06 before implementation. Resolve the `DECISION REQUIRED` items with the founder before implementing their dependent money flows. Complete the integration spikes before treating a diagram or adapter interface as proof that an external protocol supports it. Mark each integration LIVE TESTNET, LOCAL SIMULATION, MANUAL, or MOCK in configuration and UI.

Use the application API definitions as proposed interfaces owned by this project. Use the pinned upstream specifications for x402, Masumi, and CRE wire formats; application examples are not replacements for those standards. Record selected upstream versions, addresses, networks, and tested transaction traces.

For project behavior, document 00 owns decisions, 01 owns product scope/economics, 02 owns architecture/state, 03 owns proof policy, and 04 owns API/data contracts. Research notes are supporting analysis, not competing schemas. In particular, use document 03's `PASS` / `FAIL` / `INCONCLUSIVE` verdict vocabulary rather than alternative names in research examples. Resolve any upstream contradiction through an integration test and update the affected specification.

Preserve the distinction between order placement, delivery, verification, result submission, and final settlement. A receipt hash binds bytes; it does not establish that goods were bought or delivered. A successful x402 funding response does not establish that escrow has paid the filler.

Start with the prerequisite checks and protocol spikes in document 05. Do not present this pack as fully implementation-ready until document 00's decision table and readiness checklist are resolved.
