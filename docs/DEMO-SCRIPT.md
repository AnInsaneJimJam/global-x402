# Demo script (recorded, with pauses)

**Story:** a buyer tells their Claude agent what they want. A filler with a card buys it on Amazon.in and is paid in tUSDM from a Masumi escrow, after a Chainlink CRE confidential workflow verifies Amazon's own email.

**Before you press record**
- Running: `npm run dev`, `npm run worker` (keep this terminal visible for the `[cre]` lines), and the Masumi Docker node.
- Browser tabs: dashboard `http://127.0.0.1:3000`, Amazon.in (logged in), Gmail, Cardanoscan Preprod.
- A **new** Claude Code session with the `order-for-me` skill and the `global-order-book-buyer` MCP server connected.
- Pick the product and copy its exact title, link and total price (including delivery).
- Privacy: blur the delivery address, phone number and card details in editing.

---

## Scene 1: the idea (≈20 s)
**Show:** the landing page, "Global Order Book.", then scroll to *How it works*.

> "Agents can hold money, but they can't shop at real stores. People with cards can. Global Order Book connects them: a buyer's AI agent posts what it needs, a human filler buys it with their own card, and the filler gets paid from an on-chain escrow only after the purchase is proven."

## Scene 2: the buyer prompts their agent (≈45 s)
**Show:** the Claude Code session. Type:
> *Order me "<exact Amazon.in title>" — <amazon.in link> — ₹<total> including delivery. Pay the filler <total ÷ 70> tUSDM.*

The agent reads the buyer profile, shows the one-line summary, you say **yes**, and it posts the order.

> "As the buyer, that's all I do. My delivery address and spending limits are configured in the agent. It checks the merchant allowlist and my cap, then posts the order to the order book. From here the agent works on its own: when a filler claims the order, it locks the payment in escrow with my own wallet."

## Scene 3: the filler's order book (≈45 s)
**Show:** the dashboard → *Launch app* → *Connect as filler*. The new order sits among the SAMPLE listings.

> "Now I'm the filler. This is the live order book. The rows marked SAMPLE are illustrative; this one is the order my agent just posted. Each order shows what I spend in rupees, what I receive in tUSDM, and the rate. I set the rate range I'm happy with, and the best match is highlighted."

Set the range, point at **BEST MATCH**, then click **Claim** → **Confirm action**.

## Scene 4: the agent funds the escrow (≈20 s, then pause)
**Show:** switch to Claude. The agent reports *claimed → lock of X tUSDM submitted from the buyer wallet*, with a Cardanoscan link. Open the link.

> "The agent saw the claim and locked the payment in a Masumi escrow on Cardano. Nobody prompted it. The filler can't see the address until the money is actually locked."

⏸ **PAUSE THE RECORDING.** Say first:
> "Confirmation plus Masumi indexing takes about ten minutes on the testnet, so I'll skip ahead."

## Scene 5: funded, filler buys on Amazon (≈90 s)
**Resume** when step 2 *Buyer locks the payout* shows ✓.

> "Locked, about <N> minutes later. Now the delivery details are revealed, only to me as the assigned filler."

**Show:** step 3, *Buy it on Amazon.in*. Point at:
- **Open product on Amazon.in**: one click to the exact product;
- the **delivery name, starting with the order code** (e.g. `GOB… Ishaan`);
- the maximum price.

> "The code at the front of the name ties this Amazon order to this escrow. It shows up in Amazon's confirmation email."

Click **I'm placing the order now**, open the product link, then do the checkout on Amazon: paste the address, name with code first, card or UPI. Blur the card in editing.

Back on the dashboard, enter the **Amazon order number** → **Order placed**.

## Scene 6: proof and Chainlink CRE (≈60 s)
**Show:** Gmail → the Amazon "Ordered" email → ⋮ → **Download message**. Drop the `.eml` in step 4 → **Submit proof**.

> "My proof is Amazon's own confirmation email. Amazon signs it with DKIM, so I can't fake or edit it."

**Show:** the worker terminal `[cre]` lines, then step 5 turning ✓ one check at a time.

> "A Chainlink CRE workflow checks it inside a confidential enclave. It verifies Amazon's DKIM signature and that the email matches the order: the code in the name, the city, the item, the total, the order number, and that it was placed after the escrow was funded. The buyer's address never leaves the enclave. All twelve checks pass."

## Scene 7: settlement (cut the wait)
**Show:** step 6: *result due*, *dispute window ends*. The result transaction appears under *On-chain*.

> "The verified result is written to the escrow. Masumi keeps a dispute window as a safety net for the buyer, then pays the filler automatically."

⏸ **PAUSE** until step 6 shows **Paid** (about 70 minutes after the claim). Resume:

> "Paid. The filler spent rupees with their own card and received tUSDM. The buyer's agent got a real product without ever touching a card."

Open the payout transaction on Cardanoscan, and switch to Claude to show the agent reporting *paid*.

## Scene 8: close (≈20 s)
> "One order book for agents and people: agents post, humans fill, Chainlink CRE verifies privately, and Masumi escrow settles. This ran on the Cardano Preprod testnet with test tokens and a real Amazon.in order. Next: deploying the CRE workflow to Chainlink's confidential network and adding more merchants."

---

### Honest limits (if asked, or for one slide)
- Cardano Preprod test tokens; operator-held test wallets on one Masumi node.
- CRE runs as a confidential workflow in local simulation; deploying it needs Chainlink's Confidential Workflows beta.
- We verify that the order was placed (Amazon's email), not that it was delivered.
- Fillers sign in with a dev token; wallet login is next.

### Timings to expect (from the claim)
| Event | When |
|---|---|
| Agent submits lock | under 1 min |
| Step 2 ✓ (locked) | ~8–12 min |
| Amazon email arrives | 1–3 min after buying |
| CRE verdict | ~10 s after upload |
| Upload proof by | claim + 35 min (hard limit claim + 45) |
| Payout | ≈ claim + 70 min |
