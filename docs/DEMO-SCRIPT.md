# Demo script: 2 minutes, recorded with pauses

The idea is covered in the separate 1-minute video. This is only the live flow, about 280 spoken words.
**Claude terminal = the buyer. Dashboard = the filler.**

**Before recording:** `npm run dev`, `npm run worker` (worker terminal visible) and Masumi Docker are running; a new Claude Code session has the buyer tool connected; the dashboard is open and connected as filler; Amazon.in and Gmail are open. Blur the address, phone and card in editing.

| Time | Show | Say |
|---|---|---|
| **0:00–0:10** | Split screen: Claude terminal on the left, dashboard on the right | "Left is the buyer, just their Claude agent. Right is the filler's dashboard." |
| **0:10–0:30** | Claude: type *Order me "<exact title>" — <amazon.in link> — ₹<total> incl. delivery, pay 2 tUSDM* → agent summary → "yes" → posted | "The buyer asks their agent for a product. The agent checks its spending policy and posts the order. That's all the buyer does." |
| **0:30–0:45** | Dashboard: the new order appears among SAMPLE rows → set rate → **BEST MATCH** → **Claim** | "The order appears live on the order book. The filler picks the best rate and claims it." |
| **0:45–0:55** | Claude: agent reports *lock submitted from the buyer wallet* + Cardanoscan link | "The agent sees the claim and locks the payment in Masumi escrow on Cardano, on its own." |
| ⏸ | **Pause** | — |
| **0:55–1:15** | Dashboard: step 2 ✓ → step 3 shows **Open product on Amazon.in** + name with code → buy on Amazon (fast-cut) → enter order number | "Once funds are locked, the filler sees the delivery details and buys on Amazon with their own card. The order code goes in the name." |
| **1:15–1:40** | Gmail → Download message → drop `.eml` → **Submit proof** → worker `[cre]` lines → 12 checks ✓ | "The proof is Amazon's own signed email. A Chainlink CRE confidential workflow verifies the signature and the order details. The buyer's address never leaves the enclave. All checks pass." |
| ⏸ | **Pause** until step 6 shows **Paid** | — |
| **1:40–2:00** | Dashboard step 6 **Paid** → payout tx on Cardanoscan → Claude: agent reports paid | "After the dispute window, the escrow pays the filler in tUSDM. The buyer got a real product; the filler got paid; nobody shared a card." |

**Timing cheat sheet (from the claim):** lock submitted < 1 min · step 2 ✓ ≈ 8–12 min · Amazon email 1–3 min after buying · CRE ≈ 10 s · **upload proof by claim + 35 min** · payout ≈ claim + 70 min.
