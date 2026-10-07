# Decisions and readiness

This is the authoritative decision register. Confirmed decisions reflect the user's explicit choices; remaining recommendations are design proposals. The user selected architecture A for the MVP: buyer intent → filler claim → funds locked to that filler → fiat purchase → verified order placement → settlement. The original lock-before-match diagram is preserved as historical context, not the selected implementation sequence.

## Product decisions and remaining gates

| ID | Decision | Recommendation | Consequence / status |
|---|---|---|---|
| D1 | Demo or real-money launch? | Hackathon MVP with two autonomous agents | CONFIRMED by user. Buyer agent purchases; filler agent seeks a favorable stablecoin acquisition opportunity and fulfills an order. |
| D2 | What earns payout? | Independently verified order placement | CONFIRMED by user. Delivery failure after payout is outside MVP protection. Exact merchant acceptance/payment-state mapping still needs G4 validation; native dispute/collection delays still apply. |
| D3 | Asset | Supported Cardano test token first; real stablecoin later | CONFIRMED by user. USDC itself is not mandatory. Proposed initial integration is Preprod tUSDM plus tADA, validated in G1/G6. |
| D4 | Funding before filler selection | A: match first, then fund direct filler escrow | CONFIRMED by user. Filler accepts before funding; platform does not first collect escrow proceeds. No-result recovery remains an integration acceptance requirement. |
| D5 | Merchant | Familiar merchant/platform with usable checkout and evidence access | PRIORITY CONFIRMED; exact platform pending feasibility. Amazon is optional. Our own demo merchant is last resort, not the default. |
| D6 | Deadline and team | Dependency-driven milestones without a fixed calendar | User says not to constrain the plan by deadline. Team size unspecified; does not block the technical plan. |
| D7 | Protocol fallback if x402 lifecycle spike fails | Preserve Masumi escrow through native MIP-003; report x402 purchase funding as incomplete | Contingent DECISION REQUIRED. Native Masumi alone does not satisfy a mandatory x402 funding requirement. Do not silently substitute it. |

## D4: selected architecture and alternatives not selected

**A — Match first, fund second (selected).** Publish an unfunded intent, reserve one eligible filler, obtain their Masumi seller terms, fund escrow to that seller, then authorize the purchase. Buyer software can automate matching/funding within wallet policy, so another human interaction is not inherently required. Unfunded intents must visibly say `AWAITING FUNDING`. If the filler changes after funding, resolve/refund the existing escrow before funding another. A filler must support the selected Masumi seller identity/wallet arrangement. Permissionless self-service onboarding is later scope; use provisioned test sellers initially.

**Refund clarification:** naming a filler as seller does not transfer escrow ownership to them unconditionally. The escrow also binds the buyer and its native refund/dispute rules. The platform does not need to receive the money for an allowed refund to return to the buyer. Whether a missing result permits timed withdrawal, requires a refund request/authorization, or escalates must be established against the actual selected contract/driver in G3. A cannot be declared ready until a vanished-filler/no-result case is tested. Choosing B does not by itself add delivery protection; payout timing is an independent choice.

**B — Platform seller, lock first (not selected).** The platform would be the named Masumi seller, collect escrow proceeds and separately pay the selected filler. This preserves the original diagram's order but introduces platform payout/custody trust. Retained for decision context only; do not implement in the MVP.

**C — Additional contract, lock first with later filler assignment (not selected).** This would need an additional reviewed orderbook contract and a demonstrated Masumi composition. Retained for future design context; custom assignable escrow is outside the MVP.

Documents 01–07 specify **A as the selected architecture**. Research notes may discuss alternatives; those discussions do not override this decision. Any future change to B or C requires an explicit product decision and corresponding revisions to architecture, API, economics and tests.

## Agent-system design decision

The user requested a coherent agent-first system, accurate control and minimal resource expenditure. The design now uses a shared control view, typed inspect/act interface, prepared effects, durable operation receipts and deterministic actor-local runners. [Document 07](07-agent-system.md) owns these interaction requirements. This implements the selected product architecture without changing custody, the payout predicate, accepted delivery risk or upstream protocol semantics.

Capability discovery and reusable adapter knowledge are versioned and grounded in conformance evidence. They cannot confer signing authority or replace integration gates. The design is selected; implementation and operational performance remain untested.

## Resolved design proposals independent of those answers

- Escrow assets live on-chain; the backend stores order metadata, evidence references, and transaction observations.
- Buyer agent frameworks remain external. Expose an HTTP API and small reference client rather than requiring a proprietary assistant.
- Fillers use their own merchant account/payment method. MVP does not collect card numbers, CVV, bank credentials, or Amazon passwords.
- Funds become available only after chain observation satisfies configured confirmation policy.
- Images and LLM interpretations can assist review; authoritative evidence determines automatic approval.
- Begin with a browser dashboard. A native download is not necessary to prove the marketplace mechanism.
- Buyer and filler each have a reference autonomous agent. The dashboard supervises their work; manual filler checkout is only a separately disclosed fallback, not the target demo.
- One fixed quote covers the exact item and landed purchase cost; no partial fills, substitutions, auctions, foreign exchange, or split shipments in MVP.
- Wallet-signature authentication and scoped tokens replace platform passwords; infrastructure credentials may still be needed privately.

## Protocol readiness gates

| Gate | Evidence required before dependent implementation |
|---|---|
| G1 — x402 escrow | Pinned Cardano `exact` scheme with Masumi method; reproducible 402 → signed payment → confirmed lock trace; payment header interoperability checked against selected facilitator/client. |
| G2 — identity and recipient | Provisioned buyer/seller identities; demonstrated seller key/address binding; confirmed mapping to filler payout destination. |
| G3 — release authority | Tested current validator/Node: who can submit result, who can collect, which clock bounds apply, refund route, dispute authority, all fees. Establish whether CRE is advisory or actually enforced. |
| G4 — evidence | Merchant test credential/source, recorded order fixture, demonstrated independent lookup, immutable order-to-recipient binding. |
| G5 — CRE | Installed compatible CLI/SDK; successful workflow simulation; deployed access and report-consumption method separately established. |
| G6 — economics | Real protocol fee rules and ADA costs/minimum UTXO requirements measured; quote funds the promised filler net receipt. |
| G7 — agent control | Fresh-session recovery of buyer/filler obligations; stale-plan rejection; actor-local/coordinator checkout reconciliation; deadline-aware deterministic waiting; authority scopes and generated schema consistency; measured context/call budgets. Mock traces validate the interface, while external claims still require G1–G6. |

**Known G1/G3 incompatibility:** the official Cardano x402 SDK currently uses an authorization payload that the standard Masumi Node rejects for purchase initialization. The target x402 flow therefore requires tested x402-aware lifecycle tooling. A native MIP-003 fallback is a distinct integration mode, not an interchangeable driver. See [research](research/masumi-x402.md).

The research documents contain upstream evidence, not executed integration tests. No G gate has passed merely because a documentation page describes it.

## Ready-to-build checklist

- [ ] D1–D6 answered, D7 resolved if triggered, and all documents revised consistently.
- [ ] G1–G3 resolve the chain integration and the limits of backend/CRE control.
- [ ] G4–G6 have viable tested inputs and an agreed fallback scope.
- [ ] Payout trigger, fees, cancellation policy, and dispute deadlines are visible to both parties.
- [ ] All simulated components and remaining central trust are named.
- [ ] G7 control/recovery scenarios and resource measurements pass; no new agent interface hides an unresolved external capability.
- [ ] Milestone ownership is assigned when builders start; no fixed deadline is assumed.

Once implementation is separately authorized, unresolved gates permit only neutral order models, interface skeletons, and test fixtures under labeled mocks; the agent must not fill unresolved settlement details with invented APIs or guarantees. The current request stops after documentation.
