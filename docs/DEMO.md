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
5. **Purchase details**: copy `examples/buyer-agent/purchase.example.json` to `examples/buyer-agent/purchase.json` (git-ignored; it holds a real address) and set:
   - `itemTitle`: the product title **exactly** as Amazon.in shows it in the order email;
   - `fiatMinor`: the **order total including delivery** in paise (₹50.00 → `5000`); pick an item with free delivery;
   - `netTokenUnits`: tUSDM the filler receives, 6 decimals (0.60 tUSDM → `600000`);
   - `recipient`: real delivery name/address in India, **with `state`** (Amazon emails show city + state).

## Before each take

```sh
npm run dev       # API + dashboard on http://127.0.0.1:3000
npm run worker    # escrow terms, funding observer, DKIM verification on Chainlink CRE (VERIFIER=CRE, local simulation), result submission
```

Open the dashboard twice (side by side): `http://127.0.0.1:3000/#token=<DEV_BUYER_TOKEN>&persona=buyer` and `…#token=<DEV_FILLER_TOKEN>&persona=filler` (tokens are in `.env`; the fragment never leaves the browser). Have Cardanoscan Preprod open in a tab.

## Shot list

| # | Scene | Do | Say / show |
|---|---|---|---|
| 1 | Setup (20s) | Show both dashboards and the labels: *Cardano Preprod · Masumi escrow · LIVE*, *amazon-in · filler checkout · LIVE*, *proof: DKIM email*. | Two agents, one escrow, one proof. Test tokens, real Amazon order. |
| 2 | Buyer posts (30s) | `npm run buyer -- examples/buyer-agent/purchase.json` | Agent checks merchant allowlist + spending cap, posts the exact item. |
| 3 | Filler picks + claims (30s) | `npm run filler` | "Compared N orders… chose X (lowest fiat per token)". Claim → filler's node issues escrow terms. |
| 4 | Buyer funds (cut wait) | Buyer agent: "Escrow terms match policy; funding…" → "Escrow locked". | Open the **lock tx** link from the dashboard on Cardanoscan. ~1–3 min. |
| 5 | Real checkout (60s) | Filler terminal prints instructions; the recipient name **starts with the GOB code** (e.g. `GOB-7F3KQ2 Alice Doe`) — Amazon.in shows only the first word of the name in its email. Place the order on screen; type the order number. | Filler pays with own card; nothing about the card touches us. |
| 6 | Proof (45s) | Gmail → ⋮ → Download message; give the `.eml` path. Dashboard: every check turns **PASS**. | Amazon's own DKIM signature + GOB code as the ship-to name + city/state + item + total + timing. |
| 7 | Result on chain (cut wait) | Timeline: *Result submitted to escrow* → *Dispute window*. Open the result tx. | Escrow now waits out the dispute window. |
| 8 | Payout (cut ~25 min) | Timeline: *Paid out to filler*. Open the payout tx; show filler wallet on Cardanoscan. | Filler received tUSDM; economics panel shows effective rate. Masumi V2 takes no protocol fee. |
| 9 | Safety (optional, 45s) | Second order: upload an edited email → **FAIL**, buyer Rejects → refund requested → (cut) **Refunded**. Or restart the filler agent after answering `unsure` → it reconciles and refuses to buy twice. | Fake proof can't get paid; uncertain checkout never double-buys. |
| 10 | Honest limits (20s) | Slide. | Preprod test tokens; operator-held test wallets on one node; placement (not delivery) is verified; Amazon.in email shows only city/state; verification runs in a local CRE simulation (no DON deployment access yet). |

### Timings (from the moment the filler claims)

| Event | When | Source |
|---|---|---|
| Pay-by (buyer must lock) | +10 min | coordinator deadline |
| Result due (order + email + verify) | +60 min (`ESCROW_RESULT_WINDOW_MIN`) | coordinator deadline |
| Unlock | result due + 16 min | Masumi requires ≥ 15 min |
| Automatic payout to filler | ≈ unlock + 10 min | Masumi auto-withdraw job |
| Automatic refund if no result | ≈ result due + 10 min | Masumi auto-refund job |

Plan ~1h45m of wall-clock per full take; most of it is cut.

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
| Verification INCONCLUSIVE on a real email | Run `node --import tsx scripts/check-eml.ts <file>`; DKIM key fetch or a layout change. The buyer can approve manually (labelled MANUAL). |
| UI shows nothing | Wrong token in the URL fragment, or API not running. |
