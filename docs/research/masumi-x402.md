# Masumi and x402 integration feasibility

Research date: 2026-10-07. Scope: public primary documentation and published source documentation; no chain transaction or SDK integration was executed. This is implementation research, not proof that a particular deployed version works end to end.

## Decision-relevant findings

The proposed marketplace is feasible as an application, but four assumptions need explicit treatment: the escrow beneficiary is selected before funding; a hash is not evidence of a real purchase; backend verification does not itself confer contract withdrawal authority; and the advertised $0.10 reward must survive protocol and chain costs.

**There are two different x402 payment paths.** Masumi's overview describes direct payment, but the same page explicitly identifies `assetTransferMethod: "masumi"` as an escrow variant. Do not interpret its direct-payment comparison table as saying x402 cannot lock Masumi escrow. [Masumi x402 documentation](https://www.masumi.network/dev/masumi/core-concepts/x402)

**The integration boundary is currently material.** The official `@x402/cardano` README says its Masumi locks use the real V2 validator but sign a different authorization payload than Masumi Payment Service expects. The node can locate the UTxO but rejects purchase initialization; later result/refund/dispute actions require x402-aware tooling. The SDK also defaults dollar prices to USDM, so USDCx must be configured explicitly. SDK client, server and facilitator implementations exist; the client signs, the facilitator broadcasts. Its default quote deadlines are 15/35/55 minutes after `payByTime`. [Official Cardano package README, especially “Relationship to masumi-payment-service”](https://raw.githubusercontent.com/x402-foundation/x402/main/typescript/packages/mechanisms/cardano/README.md)

**Core scheme constraints:** `sellerAddress` and optional `sellerReturnAddress` are signed into the quote and escrow datum. Funding concludes at `FundsLocked`; x402 does not execute subsequent release. Supported identifiers are `cardano:mainnet`, `cardano:preprod`, `cardano:preview`; Preview needs an explicit deployment. One requested asset is supported. Seller addresses must have key credentials. Native-token locks additionally need structural ADA, calculated from protocol parameters. Minimum gaps are 5 minutes from payment deadline to result deadline, then 15 minutes to unlock and another 15 minutes to external dispute unlock. Default cooldown is 7 minutes. Arbitrators only resolve `Disputed` escrows after the external deadline; they are not arbitrary early-release operators. The specification pins the canonical V2 blueprint to commit `d74b2c319228bcbef36632de37875c388dcee7ce`. [Normative Cardano exact scheme](https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_cardano.md)

## Asset and environment selection

Circle announced USDCx on Cardano on February 27, 2026. This is a USDC-backed asset using xReserve; calling it native Circle-issued USDC would erase a meaningful distinction. Circle publishes mainnet and testnet asset fingerprints. Asset fingerprints are not the `policyId.assetNameHex` identifier required by the x402 Cardano wire format. [Circle announcement](https://www.circle.com/blog/usdcx-on-cardano-now-available-via-circle-xreserve)

Masumi's current token documentation names USDCx on Mainnet and tUSDM on Preprod. Use **tUSDM + tADA on Preprod** for the first integrated demo unless a tested alternative is specifically selected. Display the actual ticker and network everywhere, and never portray testnet balances as redeemable dollars. [Masumi token documentation](https://www.masumi.network/dev/masumi/core-concepts/tokens), [Masumi environments](https://www.masumi.network/dev/masumi/core-concepts/environments)

The current API/node README documents Mainnet and Preprod support, encrypted hot-wallet storage, webhooks and automated settlement. Its infrastructure still requires configuration and provider credentials. “No API keys” should describe the buyer-facing commerce interaction, not claim that the entire infrastructure or merchant checkout has no credentials. [Masumi Payment Service README](https://raw.githubusercontent.com/masumi-network/masumi-payment-service/main/README.md)

## Lifecycle, fees and evidence

Masumi's documented native flow provides result submission, a buyer refund-request window, seller refund authorization, and escalation. Public docs name `POST /purchase/request-refund` and `POST /payment/authorize-refund`; these are Masumi node routes, not proposed marketplace API routes. Settlement requires chain transactions and node processing. A UI state change cannot move the money. [Refunds and disputes](https://www.masumi.network/dev/masumi/core-concepts/refunds-and-disputes)

The public fee guide currently states a **5% Masumi network fee**, plus ADA fees for funding, result submission and collection. At that rate, a 5.10 gross escrow leaves 4.845 before ADA costs. To deliver 5.10 net under a simple 5% deduction requires at least `5.10 / 0.95 = 5.368421...` gross before other costs. These are arithmetic examples, not a verified V2 fee quote: confirm actual fee treatment in the selected deployment before freezing pricing. Specify product cost, filler reward, protocol fee, platform fee, ADA cost and any subsidy independently. [Masumi fee guide](https://www.masumi.network/dev/masumi/core-concepts/transaction-fees)

The smart-contract tutorial uses an older-looking action/datum layout and discusses a 5% withdrawal fee and admin resolution; this differs from the 19-field V2 scheme. Do not copy its illustrative transaction code into V2. Pin node, SDK and contract versions and derive the actual transition/fee rules from the corresponding validator. [Payment contract tutorial](https://www.masumi.network/dev/masumi/documentation/technical-documentation/smart-contracts/payment-smart-contract)

Decision logging commits a hash of the input/output. This establishes data commitment, not that a merchant accepted a genuine paid order, the address matches, or goods were delivered. The marketplace needs an independent evidence policy and verifier. [Decision logging](https://www.masumi.network/dev/masumi/core-concepts/decision-logging)

## Capability assessment

| Requirement | Assessment | Implementation consequence |
|---|---|---|
| Pay an endpoint directly using x402 | Documented | Direct settlement has no escrow lifecycle. |
| Lock Masumi V2 through x402 | Documented | Requires later x402-aware lifecycle tooling; test before promising. |
| Feed SDK-created x402 escrow into ordinary Masumi node lifecycle | Explicitly incompatible in current SDK README | Do not compose these paths without a tested adapter. |
| Lock first, pick arbitrary filler later | No supported mutation found | Treat as unsupported in the native path until demonstrated otherwise. |
| Backend proof checker unconditionally releases escrow | Not established | Model which actor signs each allowed transition; verification and authority are separate. |
| Receipt screenshot proves purchase | Insufficient | Require merchant-origin evidence or label demo evidence as a fixture. |
| Immediate withdraw after proof | Not established | Honor real contract windows; distinguish verified from withdrawable and paid. |
| On-chain agent discovery and identity | Documented | Register the order-book service and optionally fillers; verify ownership, endpoint and network. |
| $5.10 escrow guarantees $5.10 filler receipt | False under documented 5% deduction | Quote net and gross separately; record any subsidy. |
| Any external agent wallet can participate unchanged | Not established | Supply supported Cardano signer/connector requirements and asset checks. |

The registry mints an NFT representing an agent's identity and metadata; registration needs a funded selling wallet, node configuration and ADA. An identity NFT does not establish purchase honesty or marketplace reputation by itself. [Agent identity and NFT documentation](https://www.masumi.network/dev/masumi/documentation/technical-documentation/agent-identity-nft)

## Architecture options — recommendations, not decided product requirements

1. **Match before native escrow funding:** publish an unfunded intent, reserve a filler, obtain seller-specific terms, have the buyer fund, confirm on-chain, then allow the filler to purchase. Keep the reservation alive through funding and never label an unfunded listing as guaranteed. This is the smallest candidate for direct buyer-to-filler settlement, but it changes the user's original fund-before-list sequence.
2. **Platform is the Masumi seller:** buyer funds a fixed platform identity, platform selects a filler later, then owes the filler a separately executed payout. This preserves early funding but adds platform settlement/custody and insolvency trust. It is not direct filler withdrawal from the original escrow; a failed second payout needs reconciliation and liability handling.
3. **Custom assignable order escrow:** implement explicit claim, verifier, timeout, refund and payout rules. This best matches fund-before-match, but adds contract development, security review and a separate compatibility surface. Using x402's generic script mechanism would not make the custom contract the canonical Masumi escrow.

In all options, the filler pays a merchant with their own fiat and acquires crypto after work. Marketing should describe this as paid fulfillment with a reward; the economics do not remove merchant, payment-provider, chargeback or settlement risk.

## Required feasibility spikes and acceptance evidence

1. **Version and asset manifest:** record exact node/SDK revisions, validator blueprint hash, network, script address, distinct arbitrator keys/threshold, token policy/name/decimals and confirmation policy. Resolve documentation differences with executable artifacts.
2. **Smallest native lifecycle:** on Preprod, fund a selected filler, submit a result, observe actual unlock/collection, request and authorize a refund, and test no-result timeout. Save transaction hashes, datum snapshots, transition signers, durations and fee breakdowns. Verify whether the service identity's controller can bypass backend verification by submitting any hash; if so, document the buyer-monitoring/arbitration trust model explicitly.
3. **x402 interoperability:** demonstrate actual x402 Masumi lock, then attempt the pinned node's purchase-init with logs redacted. If rejected as documented, either supply a separately tested lifecycle driver or choose native MIP-003 for the MVP. Do not fake escrow with a direct-payment receipt.
4. **Beneficiary selection:** inspect validator preservation rules and try to alter seller/return address in a local/testnet transaction. Unless a supported safe transition exists, retain the selected architecture option; never silently reassign a funded order.
5. **Buyer safety:** reject wrong asset/network/address, modified commitment, expired quote, duplicate payment and reused receipt. Reconcile pending confirmations and process restarts before permitting a fiat purchase.
6. **Economics:** demonstrate the exact net token amount received and who paid every ADA fee. A simulated $0.10 reward requires an explicit subsidy line if real protocol costs exceed it.

## Research limitations

The normative scheme and official SDK README were readable. Direct retrieval of the pinned Aiken validator/blueprint failed through the web tool; shell `curl` also failed DNS resolution. No validator-level proof of beneficiary immutability, fee rate, early collection, or verifier authorization has been executed. No dependency installation, wallet creation, registration, transaction, or external mutation was performed. The implementation plan must treat those checks as gates, not completed work.
