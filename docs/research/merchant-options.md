# Familiar merchant options

Research date: 2026-10-07. Documentation review only; no account access, checkout, API credential or merchant permission has been tested. This note supplements the earlier CRE research and supersedes its recommendation to default to a controlled merchant: the user prefers a familiar merchant/platform, with a custom demo merchant only as last resort.

## Candidates and access gates

| Candidate | Documented capability | Gate before selection |
|---|---|---|
| Amazon Business | Ordering API places orders and retrieves details; Reporting API offers authorized order-history access | Approved developer/customer onboarding, an authorized Business account, configured purchasing/payment arrangement, suitable region and actual evidence fields |
| eBay | Buy APIs offer guest/member checkout integration | Checkout methods require approval even in sandbox; ordinary developer registration alone is insufficient |
| Another familiar merchant with a cooperating operator | Potential checkout plus merchant-side order-status access | Name the merchant, establish authorization, and demonstrate both purchase and independent lookup before promising support |
| Custom demo merchant | Can implement exact test fixtures and evidence schema | Last-resort scope choice; clearly label operator-controlled source and simulated fiat payment |

Amazon Business's official Ordering API supports `placeOrder` and `orderDetails`, uses customer authorization, and includes shipping/payment attributes and price expectations. Its safeguards can allow substitutions or partial acceptance; the project must reject those for its exact-item MVP. This is a business integration, not universal access to arbitrary consumer Amazon accounts. [Ordering API](https://docs.business.amazon.com/docs/ordering-api)

Amazon Business Reporting requires the documented onboarding, credentials and roles. Treat reporting access and permission to place orders as separate capabilities. Verify returned recipient, item, cost and payment facts against real authorized responses before choosing it as the proof source. [Reporting API](https://docs.business.amazon.com/docs/reporting-api-overview), [Order lookup](https://docs.business.amazon.com/docs/order-by-order-id)

eBay expressly restricts guest and member checkout methods in sandbox until checkout access has been approved. Its guest checkout also has prescribed user experience requirements. An official sandbox integration would demonstrate simulated purchases on eBay's test platform, not real purchases or unconditional unattended checkout access. [Buy API requirements](https://developer.ebay.com/api-docs/buy/buy-requirements.html)

## Ordered feasibility work

1. Inventory merchant/developer accounts and authorizations the team can actually obtain. No account provisioning or external application has been performed during this planning task.
2. Investigate Amazon Business ordering plus evidence first if eligible access is available, because it preserves the original familiar purchase story. Treat eBay as a candidate if the required checkout approval is obtainable. No deadline-driven assumption makes either access gate disappear.
3. For each candidate, demonstrate the filler agent placing one authorized test order, then independently retrieving it. Capture exact SKU, quantity, total/currency, recipient, purchaser binding, accepted-order state, cancellation state and timestamps. Determine the merchant's payment-state semantics; an accepted order does not necessarily mean card capture.
4. Demonstrate timeout recovery without a second purchase, and invalid/canceled order rejection. Evaluate unavoidable human authentication challenges and disclose any automation limit.
5. Select a platform only after both checkout and proof pass. If candidates fail, investigate another familiar cooperating merchant before proposing a custom demo merchant.

The confirmed MVP predicate is order placement, not delivery. Later shipment tracking is useful but does not repair absent purchase evidence. Static API sandbox fixtures demonstrate parsing and integration shape; they do not prove the filler actually purchased the submitted order. Label such tests accordingly and keep them distinct from an end-to-end transaction.
