# Recording the demo

A fully recorded, end-to-end run on **Cardano Preprod**: a buyer agent buys a real item from **Amazon.in** through a filler who pays with their own card and is paid in **tUSDM** (Preprod test stablecoin) from Masumi escrow, after the merchant's **DKIM-signed confirmation email** proves the order was placed.

Nothing is live in front of judges. Record each scene, cut the waiting, and keep timestamps visible so cuts are honest.

## What the viewer should take away

| Persona | Story | Proof on screen |
|---|---|---|
| Buyer (has crypto, wants a product) | "My agent bought a Coke with stablecoins it held. It never touched a card, and the money sat in escrow until there was proof." | Buyer terminal, lock tx on Cardanoscan, dashboard timeline |
| Filler (has a card, wants crypto) | "I paid ₹X on Amazon with my own card and received tUSDM. My Amazon email was the proof; I never shared card details." | Filler terminal (offer choice, instructions with GOB code), Amazon order, PASS checks, payout tx to filler wallet |

## One-time setup (this machine)

1. **App database** (already created): `.local/postgres`, started with
   `$(pg_config --bindir)/pg_ctl -D .local/postgres -l .local/postgres.log -o '-h 127.0.0.1 -p 55432 -k /tmp' start`
2. **Masumi node** — follow [infra/masumi/README.md](../infra/masumi/README.md) sections 1–2 (secrets, build, preflight, offline wallets, migrate, seed, start). The Blockfrost Preprod key goes in `infra/masumi/.env` (never in chat or git).
3. **Fund the two node wallets** (`node infra/masumi/manage.mjs status` prints the addresses):
   - tADA for **both** from the [Cardano Preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet).
   - tUSDM for the **purchasing (buyer)** wallet from the [Masumi dispenser](https://dispenser.masumi.network).
4. **Wire the app to the node**: `npm run masumi:setup`. Creates buyer/filler API keys scoped to their wallets, registers the filler agent on Preprod (on-chain, a few minutes) and writes `BUYER_/FILLER_MASUMI_URL/TOKEN`, `FILLER_AGENT_IDENTIFIER`, `ESCROW_ASSET_ID` into the ignored `.env`. Re-runnable.
5. **Buyer agent profile**: copy `examples/buyer-agent/profile.example.json` to `examples/buyer-agent/profile.json` (git-ignored; real address, **with `state`**) and register the MCP server once: `claude mcp add global-order-book-buyer --scope user -e GOB_API=http://127.0.0.1:3000 -e GOB_BUYER_TOKEN=… -e BUYER_MASUMI_URL=… -e BUYER_MASUMI_TOKEN=… -e BUYER_PROFILE=$PWD/examples/buyer-agent/profile.json -- $PWD/scripts/buyer-mcp.sh`. In the prompt, give the product title **exactly** as Amazon.in shows it and the total **including delivery**.

## Before each take

```sh
npm run build:web # once after frontend changes
npm run dev       # API + filler dashboard on http://127.0.0.1:3000 (Launch app → orderbook)
npm run worker    # escrow terms, funding observer, CRE verification (VERIFIER=CRE), result submission
```

- **Buyer** = a Claude Code session with the `global-order-book-buyer` MCP server (no buyer dashboard).
- **Filler** = the dashboard at `http://127.0.0.1:3000/#workspace` → *Connect as filler* with `DEV_FILLER_TOKEN` from `.env`. The order book refreshes every 4 s; rows tagged **SAMPLE** are illustrative and cannot be claimed.
- Cardanoscan Preprod open in a tab.

## Shot list

| # | Scene | Do | Say / show |
|---|---|---|---|
| 1 | Setup (20s) | Landing page → *Launch app*. Stats strip: Cardano Preprod · Masumi · Amazon.in · Chainlink CRE. | One order book: agents post, humans fill, CRE verifies, escrow settles. |
| 2 | Buyer prompts (30s) | Claude: *"Buy me <exact Amazon.in title>, total ₹<price incl. delivery>, pay the filler 2 tUSDM. Fund it as soon as someone claims it."* | The agent checks its policy (merchant allowlist, cap) and posts the order. |
| 3 | Order appears (15s) | Dashboard: the new row appears live among SAMPLE rows. | Real order next to illustrative ones. |
| 4 | Filler picks (30s) | Set *Your rate* (e.g. ₹60–95 per tUSDM); out-of-range rows dim; **BEST MATCH** lands on the real order → *Claim* → confirm. | Fillers choose by their own conversion rate. |
| 5 | Agent funds (cut wait) | Claude: `fund_escrow` → "Lock of 2 tUSDM submitted from the buyer wallet". Dashboard step 2 turns ✓ with the **escrow lock** tx link. | The agent signs with the buyer's own key. Confirmation + Masumi indexing ≈ 5–12 min. |
| 6 | Real checkout (60s) | Dashboard step 3 shows item, max price and ship-to with copy buttons; the name **starts with the GOB code**. *I'm placing the order now* → buy on Amazon.in (card/UPI) → enter the order number → *Order placed*. | Filler pays with own card; nothing about the card touches us. |
| 7 | Proof (45s) | Gmail → ⋮ → Download message → drop the `.eml` in step 4 → *Submit proof*. Step 5: 12 checks turn ✓, *Verified on Chainlink CRE (simulation)*. | Amazon's DKIM signature + GOB code + city/state + item + total + timing, checked in a CRE workflow. |
| 8 | Result on chain (cut wait) | Step 6 shows result due / dispute window; result tx appears under *On-chain*. | Escrow waits out the dispute window. |
| 9 | Payout (cut) | Step 6 ✓ *Paid*. Open the payout tx; show filler wallet on Cardanoscan. | Filler received tUSDM; Masumi V2 takes no protocol fee. |
| 10 | Fraud attempt (45s) | Second order: upload an old/other email → CRE **FAIL** (code, name, item, timing ×). Claude: `review_evidence REJECT` → refund requested; filler *Agree to refund* → (cut) **Refunded**. | A genuine-but-wrong email can't get paid; the buyer gets the money back. |
| 11 | Honest limits (20s) | Slide. | Preprod test tokens; operator-held test wallets on one node; placement (not delivery) is verified; Amazon.in email shows only city/state; CRE runs as a confidential (TEE) workflow in local simulation; deploying needs the Confidential Workflows private beta. |

### Timings (from the moment the filler claims)

| Event | When | Source |
|---|---|---|
| Pay-by (buyer must lock) | +`ESCROW_PAY_WINDOW_MIN` (25 min) | coordinator deadline; Masumi indexing can lag ~12 min |
| Result due (order + email + verify) | +`ESCROW_RESULT_WINDOW_MIN` (45 min now) | coordinator deadline |
| Unlock | result due + 16 min | Masumi requires ≥ 15 min |
| Automatic payout to filler | ≈ unlock + 10 min | Masumi auto-withdraw job |
| Automatic refund if no result | ≈ result due + 10 min | Masumi auto-refund job |

Plan ~1h of wall-clock per full take; most of it is cut.

## After recording

You may cancel the Amazon order once the take is done (or let it deliver). Our system verifies **placement**, so it will not notice a later cancellation — say so in scene 10; it is the documented MVP limit (T23).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Buyer agent waits forever for escrow terms | Worker not running, or `FILLER_AGENT_IDENTIFIER` / `BUYER_MASUMI_TOKEN` missing in `.env` (run `npm run masumi:setup`). |
| `NO_FUNDING_WALLET_FOR_BUYER` | `FUNDING_BUYER_ID` in `.env` must be the buyer actor (`dev-buyer`). |
| `ESCROW_ABOVE_CAP` | Raise `MAX_ESCROW_BASE_UNITS` (default 50 tUSDM). |
| `PAY_BY_TOO_CLOSE` | Fund within ~8 min of claiming; otherwise re-post the order. |
| Funding stays PENDING | Purchasing wallet lacks tUSDM/tADA, or the node's batch job is still running (30 s cycles). Check `node infra/masumi/manage.mjs status`. |
| Verification INCONCLUSIVE on a real email | Usually a DKIM key fetch failure or an email layout change; check the worker log. The buyer can approve manually (labelled MANUAL). |
| Dashboard blank at `/` | Run `npm run build:web`, then restart `npm run dev`. |
| *Connect as filler* rejected | Use `DEV_FILLER_TOKEN` from `.env`; the API must be running. |
