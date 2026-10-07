# Product specification

## Purpose and success

Enable an AI agent holding a supported Cardano asset to procure an item from a Web2 merchant through a filler, with a quoted budget and escrow-backed settlement. The merchant need not integrate crypto. The filler pays fiat and receives the quoted token proceeds after the service condition and protocol settlement conditions are met.

The successful MVP demonstrates a buyer agent submitting a purchase and a filler agent autonomously selecting and executing it to acquire tokens on favorable terms, with a real testnet escrow lock, independently fetched merchant evidence, a CRE verification execution, and observable payout or refund. Prefer a familiar merchant/platform with authorized access; its official sandbox is a candidate for testing, and a custom demo merchant is last resort. Each simulated component is disclosed. A documented failure path is as important as the successful purchase.

“Global” describes the intended extensible marketplace, not launch availability in every country or support for arbitrary websites. “On-ramp with a reward” describes the economic effect; actual earnings depend on all costs and completing the work.

## Actors

| Actor | Responsibilities | Must not be assumed |
|---|---|---|
| Buyer / buyer agent | Authorize item, recipient, budget, policy, network, asset; fund; monitor/dispute | Holding USDC on another chain does not make it available in Cardano escrow. |
| Filler / filler agent | Accept exact terms, pay own fiat, submit merchant order reference, preserve evidence | A connected wallet does not prove identity, creditworthiness, or merchant purchase. |
| Orderbook operator | Quote, match, protect private data, track orders, run verifications and reconciliation | Database state cannot override contract spending rules. |
| Merchant | Accept purchase and expose verifiable order facts where supported | Amazon or any merchant has agreed to an integration. |
| CRE workflow | Fetch authorized evidence and evaluate a versioned predicate | Consensus makes a fabricated or untrusted data source truthful. |
| Masumi / Cardano | Identity, payment protocol and contract lifecycle under actual deployment | Automatic arbitration of arbitrary physical-delivery disputes or native CRE authority. |

## Selected MVP workflow (architecture A)

1. Buyer agent constructs a structured intent from “buy me this Coke.” It must resolve exact SKU/variant, quantity, merchant, recipient and all-in cost before signing. An LLM may propose these values, but deterministic policy validates them.
2. Backend validates supported merchant and region, stores encrypted delivery data, and returns a short-lived quote. The agent checks wallet limits and explicit service condition.
3. Intent appears in the filler dashboard with coarse destination region, item, fiat cost, reward, asset, deadlines, and funding status. Street address is private.
4. A filler instructs its agent to acquire tokens within a fiat budget and minimum net reward. The agent evaluates eligible orders and atomically reserves a suitable intent. The claim binds filler identity, seller terms and version. Backend issues a funding challenge matching those terms.
5. Buyer agent automatically signs/funds within its previously granted policy. Once funding is confirmed, the claim becomes a funded assignment and the filler may access delivery details.
6. Filler agent buys the exact item through a supported authorized merchant checkout integration using the filler's own payment method. The agent must reconcile ambiguous checkout responses before any retry. If an official sandbox or last-resort demo merchant is used, label simulated fiat payment explicitly. Merchant authentication, spending consent and unavoidable MFA/3DS challenges are prerequisites or explicit human intervention points, not bypassed automation.
7. Filler submits the merchant order reference and optional receipt. The verifier independently obtains merchant facts and checks them against the funded assignment.
8. Valid evidence produces a bound verification result. It allows the application to proceed with Masumi result handling; it does not itself spend escrow. Invalid evidence does not authorize application settlement; buyer monitoring and the native refund/dispute path address seller actions outside the application, as explained in document 02.
9. Buyer agent obtains the result and monitors the dispute window. Collection occurs only when current contract conditions permit. The filler UI distinguishes approved evidence, claimable funds, submitted transaction and confirmed receipt.
10. Persist an audit trail and show final buyer spend, filler receipt, reward, fee costs, and transaction links.

## Economics and quotation

Use integer fiat minor units and token base units; never binary floating-point amounts. Let `C` be verified merchant landed cost, `R` desired filler reward, `N` desired filler token proceeds, `Q` gross escrow principal, `F(Q)` protocol fees, and `P` any separately disclosed platform fee. For a fixed USD-denominated example, `N = C + R` and the quote must satisfy `Q - F(Q) - P >= N` under the actual contract rules. ADA costs are separate unless an explicit conversion/subsidy is quoted.

For illustration only: C=$5.00 and R=$0.10 imply a $5.10 **net target**. If a deployment deducted 5% of gross escrow, Q would need to be at least $5.368422 at six decimal places to deliver $5.10 before other costs. With only $5.10 locked, the net would be $4.845. The 5% is an illustrative assumption suggested by some Masumi documentation, not a fee selected for the implementation. Gate G6 measures the deployed rules.

The quote includes: item subtotal, tax, shipping, fiat currency, maximum authorized merchant charge, filler net proceeds, platform fee, protocol fee, fee payer, escrow asset identifier/decimals, chain, gross escrow amount, ADA fee/minimum-output budget, quote expiry, funding deadline, purchase deadline, verification condition/version, and native settlement/dispute times. Display any operator subsidy and its payer explicitly.

MVP purchases must match the accepted landed cost exactly. If checkout cost changes, stop and obtain a new quote before purchase. The filler bears unauthorized overruns. Under-runs also need a new quote, preventing hidden retained savings. Unused ADA attached to outputs has an explicit owner/return destination in the adapter; it is not filler reward by default.

If escrow is already funded, a revised quote cannot mutate its signed terms. Resolve/refund that funding and establish a new accepted funding attempt before proceeding, unless the tested contract explicitly supports the required change. A later move from test tokens to a real stablecoin needs validated asset identifiers/decimals, network deployment, fee rules, wallet support and fresh lifecycle tests; it is not merely renaming the ticker.

## Wallet guardrails

Reference buyer client supports per-order maximum, cumulative daily budget, merchant allowlist, supported asset/network, allowed settlement mode, maximum fee, quote expiry, recipient approval, and maximum outstanding escrow exposure. Reserve budget before signing to prevent two concurrent agents overspending a shared policy. Free budget only after terminal outcomes are reconciled. Real wallet-enforced limits require a wallet capable of enforcing them; client-side checks are not unbreakable controls.

Wallet signing remains in the wallet/agent runtime. The orderbook never receives the buyer seed phrase. A hosted Masumi Node that holds signing keys must have its custody and owner explicitly documented during G2.

## Filler agent policy and opportunity selection

The filler request includes target token/amount, maximum fiat outlay, minimum net reward or acceptable acquisition rate, supported merchants/regions, maximum settlement wait and maximum concurrent assignments. The reference agent discovers opportunities through the orderbook API, estimates net proceeds after every filler-borne cost, selects an eligible order, claims it, waits for funding, purchases, submits evidence and monitors settlement.

For comparison, compute `fiatCostPerNetToken = totalFillerFiatCost / expectedNetTokens`, and disclose separately any ADA cost and its conversion assumption. A lower number is more favorable only for otherwise comparable assets, restrictions, settlement delay and risk. “Best deal” means best among the actually observed supported offers and any fresh, source-attributed on-ramp quotes; do not claim a global best price without market data. MVP must at least compare multiple seeded orderbook opportunities and explain why it selected one. External on-ramp comparison is optional unless a real quote integration is available; seeded comparison quotes are labeled synthetic.

The agent maintains a durable purchase operation ID and merchant order reference. A crashed or timed-out checkout is reconciled before another purchase. It cannot exceed authorized fiat spend or use an unapproved recipient. Merchant/session/payment credentials stay in the filler's authorized runtime or the merchant/payment provider's vault. Central card storage is outside scope.

## Required surfaces

**Filler web dashboard:** wallet connection/sign-in; provisioned seller identity status; available intents; reservation and funding progress; private assignment details; merchant checkout link; order reference/receipt submission; verification reasons; escrow timeline; claimable and confirmed proceeds; refunds/disputes.

**Buyer reference client:** structured intent API call; quote approval through policy; asynchronous funding after match; status/result retrieval; dispute/refund requests before deadlines. Provide a machine-readable usage example and human-readable integration guide. An optional agent skill can be created during implementation, after API behavior is stable.

**Filler reference agent:** accept an acquisition goal, discover and compare eligible opportunities, enforce fiat/risk policy, claim, await funding, execute supported checkout, submit evidence and reconcile proceeds. Provide machine-readable integration documentation and an auditable explanation of its choice. The dashboard observes the same API actions and provides intervention when required.

**Operator view:** stalled orders, unavailable verifier, pending refunds/disputes, transaction reconciliation, evidence provenance, and a masked audit trail. Manual overrides are separately labeled and require a reason. A manual approval cannot masquerade as CRE verification or bypass contract conditions.

## Scope boundaries

MVP: one item/quantity line, one selected familiar merchant adapter, one fiat currency, one Cardano network/asset, one filler per purchase, fixed reward, provisioned filler identities, buyer and filler reference agents, automated supported checkout, web dashboard, proof workflow, escrow lifecycle and negative-path demo.

Later: native apps, arbitrary merchant browser agents, credential vault/card connections, seller reputation, filler staking, insurance, FX/bridging, partial fills, bidding, returns, delivery guarantees, fully automatic physical-goods arbitration, cross-country rollout and a custom permissionless lock-first contract.

The user selected order-placement verification for the MVP and accepted that delivery failure after payout is outside its protection. If a later version adds delivery or staged payout, extend the evidence schema, monitoring duration, contract capability analysis and tests; a second button does not create staged settlement support.
