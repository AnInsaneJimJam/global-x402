# STATUS — Track B (Evidence & filler)

Update at the end of every session. Newest entry on top. Keep it short; link PRs/commits.

## Current

| Task | State | Notes / link |
|---|---|---|
| B0 Real-email check (Amazon.in) | DONE (old email) | Findings below. Live DKIM PASS still to confirm on a recent email |
| B1 DKIM verifier | DONE | `packages/verification/{index,doh}.ts`, 8 tests in `tests/verification.test.ts` (synthetic emails, test-generated key). `mailauth@7.1.1` + `mailparser@3.9.36` (MIT, pinned) |
| B2 Merchant configs | DONE (amazon-in) | `packages/merchants/amazon-in.ts` + `tests/amazon-in.test.ts`; `amazon-sg` after first SG order |
| B3 Nonce + recipient + assignment | DONE | `claim` sets `GOB-XXXXXX` (unique index); `PUT /v1/recipients/:ref` insert-only; `GET /v1/orders/:id/assignment` funded-filler/buyer only, name + nonce |
| B4 Evidence upload + submit | DONE | `POST /v1/orders/:id/evidence-uploads` (message/rfc822, ≤1 MB, 0600 file under `EVIDENCE_DIR`); `submit_evidence` requires that `evidenceId`, enqueues `verify_evidence` |
| B5 verify_evidence job + manual review | DONE | `apps/worker/jobs/verify_evidence.ts` (verifies outside tx, writes only if evidence still current, PASS → `submit_result`); `review_evidence` buyer command (MANUAL label) |
| B6 Filler agent loop | NOT STARTED | |
| B7 Failure tests | NOT STARTED | |
| B8 Dashboard (stretch) | NOT STARTED | |
| B9 CRE simulation (stretch) | NOT STARTED | |

## B0 findings

- Email: Amazon.in "Ordered: …" confirmation, Jan 2026, multipart/alternative (text + HTML), downloaded via Gmail "Download message".
- DKIM: two signatures, `d=amazon.in` and `d=amazonses.com` (Amazon SES), both signing Date/From/To/Message-ID/Subject/MIME-Version/Content-Type, no `l=`. The amazon.in selector is a CNAME to `*.dkim.amazonses.com` whose key is now **revoked (`p=`)** — Amazon rotates keys, so **old emails cannot be re-verified**; verification must run soon after the order. Revoked key → INCONCLUSIVE.
- Text part fields: ship-to line `<Name> – <CITY>, <STATE>`; `Order #` then `NNN-NNNNNNN-NNNNNNN`; `* <full product title>` / `Quantity: n` / `<price> INR`; `Total` then `<amount> INR` (whole rupees seen). No ASIN in links (tracking redirects), so items match by exact title.
- Full verifier on the real email: all order-fact criteria PASS, header-consistency rules pass (25/25 identical headers across parsers), NONCE FAIL (old order has no nonce), DKIM UNKNOWN (revoked key) — as expected.
- Gmail adds ARC headers (google.com seal recording dkim=pass at receipt). Possible later fallback for rotated keys; Gmail-only, not built.

## Blockers

- None recorded yet.

## Interface change requests to Track A

- **Set `order.fundedAt`** (ISO time) when the observer marks funding CONFIRMED; verifier uses it as the earliest valid order time.
- `submit_result` handler: payload `{ resultHash }`; the hash is `order.verification.resultHash` (PASS or MANUAL approve).
- `intent.itemTitle` (optional, exact merchant title) is accepted by `create_intent`; buyer runner should send it.

## Session log

- 2026-10-07 — Merged A0 into track-b. Built B3–B5 on it: nonce at claim, private recipients + funded-only assignment, .eml upload, submit_evidence → verify_evidence job → PASS enqueues submit_result, buyer manual review. Verifier: empty nonce never passes, missing funding time/deadline → UNKNOWN, email order id must equal declared id. 39/39 tests.

- 2026-10-07 — Security review fixes: (1) duplicated From/Date/Subject (and Content-Type/CTE) headers now FAIL — DKIM signs the last copy while the parser reads the first; (2) item/quantity/nonce are read only from merchant-extracted fields (single item line, ship-to name), not the whole body, so recommendations or gift messages cannot satisfy them. **B2 rule:** `amazon-in.ts` must anchor extraction to Amazon's item table, ship-to block and order total, returning null when ambiguous.

- 2026-10-07 — B1 verifier landed on `track-b/evidence`. Decisions inside: only allowlisted merchant domains are ever looked up in DNS; signature must cover From/Date/Subject; any `l=` body-length limit is rejected (mailauth reports such signatures as `pass`, so the guard is ours); missing key / DNS failure → INCONCLUSIVE. Full suite 24/24, typecheck and contracts:check green. No shared files touched (Step 0 not yet merged).

- 2026-10-07 — Handoff created. Baseline: typecheck, contracts:check, 16/16 tests green on `feature/agent-control-recovery` @ 27a4915.
