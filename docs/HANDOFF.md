# Global Order Book — implementation handoff

**As of 7 October 2026 (Asia/Kolkata).** Continue from branch `codex/implementation-handoff` in the private repository `AnInsaneJimJam/global-x402`. The working implementation starts at commit `3167802`; this branch adds the handoff. Treat this document as a navigation and status record. The numbered design documents remain authoritative for product behavior and interfaces.

## One-minute orientation

The buyer's agent posts an exact purchase intent. A filler who wants tokens claims it **before** funding. The buyer then locks the quoted Cardano asset in Masumi escrow naming that filler. The filler pays the Web2 merchant with its own fiat, and independent merchant evidence establishes **order placement** for the MVP payout workflow. Delivery failure after payout is an accepted MVP limit. The app coordinates; it does not collect escrow proceeds for onward payment.

The product goal is **two autonomous agents after their users grant bounded authority**. The buyer agent procures an exact item; the filler agent selects a favorable eligible order to acquire tokens. Test assets may precede a real stablecoin. The first merchant should be familiar to users if authorized checkout and independent order lookup are possible. Amazon is optional; an in-house merchant is a last resort. There is no fixed deadline.

**Current state:** a tested local control service exists. Its payment, merchant, and verifier integrations are explicitly `MOCK`. The demo proves claim concurrency and safe recovery logic with fixtures. It has not locked on-chain funds, charged a card, verified a real merchant order, run CRE, or settled escrow.

## Read only what the next task needs

1. [Decisions and gates](00-decisions.md) fixes architecture A and records unresolved choices. Read this before changing the money flow.
2. [Agent interaction system](07-agent-system.md) explains the linked goal → commitment → obligation → action → observation → outcome model.
3. [Architecture](02-architecture.md) assigns state and authority; [API/data contract](04-api-and-data.md) defines the intended full interface. The running code is a smaller `0.1.0` subset.
4. [Proof and settlement](03-proof-and-settlement.md) is required before writing verification or release logic.
5. [Implementation plan](05-implementation-plan.md) gives the ordered milestones. [Tests and demo](06-tests-and-demo.md) lists 58 future acceptance scenarios; the current 16 passing tests cover only a subset.
6. [Integration manifest](integration-manifest.md) records current evidence and pinned dependencies. [Development runbook](08-development.md) has setup and commands. [Generated agent quickstart](generated/agent-quickstart.md) describes the current local client.
7. Load the relevant research only for the integration being worked on: [x402/Masumi](research/masumi-x402.md), [CRE](research/cre-proof.md), or [merchant access](research/merchant-options.md). Recheck time-sensitive upstream facts against pinned official sources before wiring them into code.

## What is implemented and where

| Working part | Files | Verified behavior and boundary |
|---|---|---|
| Typed contract and client | `packages/contracts/index.ts`, `client.ts`; `docs/generated/` | Strict command, plan, receipt and control-view validation; named client routes; generated schemas and short guide. The client never auto-pays an unexpected HTTP 402. |
| Procurement service | `packages/procurement/service.ts`, `store.ts`, `schema.sql` | PostgreSQL transactions; exact plans, role/route/version/expiry checks; atomic filler claim; durable business and transport deduplication; purchase-attempt registration; merchant-order uniqueness. Funding observations currently come only from a test fixture. |
| Filler operation runtime | `packages/agent-runtime/index.ts` | Actor-local journal and executor lock; registers checkout before execution; unknown/successful purchase blocks a second checkout; restart reconciliation and stop/resume. It is **not** a complete buyer or filler autonomous goal runner. A killed process may leave a lock that needs controlled reconciliation. |
| Offer comparison | `packages/procurement/ranking.ts` | Exact-integer ratio comparison with hard asset/network/currency, fiat, target-capacity and timing filters. It consumes supplied policy and offers; shared atomic acquisition-goal accounting remains to be built. |
| Local HTTP API | `apps/api/` | Finite named routes, redacted opportunities, owned work, control and operation reads. It listens on localhost and uses development bearer tokens. Wallet-signature authentication is absent. |
| Fixture and demo | `fixtures/adapters.ts`, `examples/control-demo.ts` | A mock funding observation and mock merchant simulate a lost checkout response. The demo reconciles `UNKNOWN` to actor-reported `ORDERED` with one checkout call; verification and settlement remain `NOT_IMPLEMENTED`. There is no public fixture-funding endpoint. |

The five pinned skills are installed locally: Cardano Foundation `build-transaction`, `query-chain`, `debug-transaction`, `connect-wallet`, and Masumi `masumi`. [Skill lock](skills-lock.json) records exact source revisions and hashes. Skill installation is a local developer setup, not a checked-in SDK or chain integration.

## Verified baseline

At the handoff, the working tree was clean and the implementation was committed. `npm run typecheck` and `npm run contracts:check` passed. `npm test` passed **16/16** cases using isolated PostgreSQL schemas and a disposable local cluster. The mock demo produced `UNKNOWN → ORDERED`, one checkout call and a 1,467-byte decision view. The generated guide was 1,615 UTF-8 bytes. These are fixture observations, not general performance or payment claims. The disposable PostgreSQL instance used for the demo was stopped.

To repeat the baseline from the repository root, use Node.js 22+, npm and PostgreSQL server binaries:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run contracts:check
npm test
```

`npm test` provisions and removes a private local PostgreSQL cluster when `TEST_DATABASE_URL` is absent. See the runbook for the separate database needed by `npm run demo` or `npm run dev`. Do not put real wallet seeds, card details, addresses or merchant tokens in test fixtures or committed files.

## What remains, in dependency order

| Priority | Work | Observable completion gate |
|---|---|---|
| 1A — Cardano payment and native lifecycle | Pin the actual network, asset, validator/SDK/Node versions and actor identities. Build a real x402 `402 → signed transaction → confirmed Masumi lock` path and an x402-aware driver for result submission, collection, buyer refund, no-result expiry and dispute behavior. Observe outputs, signer authority, fees and rollback/restart behavior. | Reproducible Preprod transaction traces for lock, payout and **vanished-filler recovery**, with exact recipient and authorized signers. A funding-only trace does not pass. |
| 1B — Merchant access | Obtain authorized API access to a familiar merchant; first investigate Amazon Business Ordering plus independent order details, with eBay as another gated candidate. Establish region, actual API costs, checkout approval, payment-state semantics, exact SKU/recipient/amount/cancellation fields and timeout lookup. | Authorized test checkout plus merchant-origin order lookup; actor receipt alone cannot establish purchase. If access is denied, document it before considering another merchant or the last-resort custom demo. |
| 1C — CRE and proof | Pin CLI/SDK and workflow version. Normalize merchant facts; verify exact order placement, source authenticity, relevance, freshness and cancellation state. Distinguish CRE simulation, actual DON execution and Cardano relay authority. | Repeatable negative/positive evidence cases; authenticated bound report consumed by the application. Never claim CRE is enforced by the Masumi validator without demonstrating it. |
| 1D — Economics | Measure actual Masumi deductions, ADA fees and minimum UTxO costs on the chosen flow. Quote buyer gross and promised filler **net** in explicit base units, with expiry and immutable accepted terms. | A measured quote reconciles buyer debit, escrow lock, protocol fees and confirmed filler receipt. |
| 1E — Complete agent control | Expand the existing interface: wallet-backed scopes/grants, shared budget and target reservations, actor run recovery, obligations/deadlines, monitored waiting, cursor gap recovery, safe executor takeover and fuller source/freshness facts. | Fresh buyer and filler sessions complete scripted goals without chat history; ambiguous money/merchant effects block duplicate action; full G7 checks and resource measures pass. |
| 2–5 — Product slice | Integrate the proven payment, merchant and proof adapters; build buyer/filler reference agents, the filler/operator dashboard and protection monitoring. Run end-to-end testnet plus negative-path demonstrations. | The exact transaction and independently verified merchant order can be shown from agent request through native payout or actual refund, with modes and limitations accurately labeled. |

The [implementation plan](05-implementation-plan.md) has the detailed milestone order. [Gates G1–G7](00-decisions.md) are **not yet passed**. The first priority is a full payment lifecycle spike because it determines the actual escrow/refund behavior. Merchant onboarding can be pursued in parallel without inventing proof access.

## Decisions and access still open

- **D5:** The founder has no merchant developer access yet and is willing to obtain free or inexpensive access. A free Amazon Business account does **not** establish Ordering API permission; its published static sandbox currently lists other APIs, not Ordering. eBay checkout needs approval even in sandbox. No paid service or real order has been authorized or purchased in this repository.
- **D7:** Native MIP-003 is a possible fallback only if the x402-aware escrow lifecycle cannot be completed and the founder explicitly accepts the reduced x402 claim. The current plan must not silently mark native Masumi as x402 funding.
- **Wallet/merchant inputs:** No buyer/filler keys, seed phrases, private merchant credentials or checkout approval are in this repository. Use local ignored `.env` files for credentials once access is obtained. Do not infer that the provisioned identities or assets in the design docs already exist.
- **Payout predicate:** The founder chose verified **order placement** for the MVP. The chosen merchant's concrete acceptance/payment states still need confirmation; an API 200 or screenshot alone does not meet the predicate.

The published `@x402/cardano@2.28.0` README states its seller authorization digest differs from the stock `masumi-payment-service` initialization check. The stock node cannot drive a lock created by that package through the full lifecycle. The package was inspected, **not installed in this app or tested on chain**. [The manifest](integration-manifest.md) records the pinned inspection. Seller result submission outside this app remains a trust concern: off-chain CRE approval alone does not stop an authorized native signer unless the selected contract actually enforces it. Buyer monitoring and the real refund/dispute windows matter.

## Suggested first actions for the next session

1. Confirm the branch, read this handoff and `docs/00-decisions.md`, then run the four baseline commands above. Preserve the current `MOCK` labels and user changes.
2. Start Milestone 1A as a bounded Preprod spike. Inspect the pinned x402 package and selected Masumi contract/driver source; establish seller key ownership, lock datum, result/refund/collection functions, and exact fees. Build the smallest executable lifecycle trace, including an absent seller. Record redacted transaction IDs and actual failed prerequisites in the manifest.
3. In parallel, investigate the cheapest **approved** merchant route. Ask the founder only for merchant onboarding decisions or credentials that cannot be derived from official docs; do not request secrets in chat. Leave the custom merchant as a last resort.
4. After external behavior is observed, update `docs/00-decisions.md` and this manifest, then replace the corresponding fixture behind the existing typed interface. Add tests for actual invariants, not tests that merely repeat code branches.

For a new agent session, a sufficient instruction is: **“Continue implementation from `codex/implementation-handoff`. Read `docs/HANDOFF.md` and the linked design documents, verify the baseline, then work through the next unmet integration gate. Keep actual and simulated capabilities distinct.”**
