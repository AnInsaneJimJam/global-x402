# Prompts for each person's coding agent

Paste the prompt for your track as the first message of a new agent session, from the repository root.

## Track A — teammate's agent (Settlement & chain)

```text
You are continuing the Global Order Book hackathon MVP in this repository. You own Track A (Settlement & chain).

1. git fetch, check out `mvp-integration`, then create or continue branch `track-a/settlement` and rebase it onto `mvp-integration`.
2. Read, in order: docs/handoff/README.md, docs/handoff/SHARED-CONTRACT.md, docs/handoff/TRACK-A-settlement.md, docs/handoff/STATUS-A.md, docs/handoff/STATUS-B.md. Then read only the design docs your current task needs (docs/02-architecture.md, docs/research/masumi-x402.md, docs/04-api-and-data.md, docs/06-tests-and-demo.md).
3. Verify the baseline: npm ci --ignore-scripts && npm run typecheck && npm run contracts:check && npm test.
4. Work the next unfinished task in TRACK-A-settlement.md in order. A0 (Step 0 shared foundation) comes first and must be merged into `mvp-integration` before anything else; keep it small and behaviour-preserving, then tell Track B it landed.
5. Decisions already made — do not reopen them: native Masumi (MIP-003), not x402; one shared self-hosted Masumi node on Cardano Preprod holding buyer purchasing + filler selling test wallets, labeled OPERATOR_HELD_TEST_WALLETS, with per-actor URL/token config; verified ORDER PLACEMENT is the payout condition; DKIM email proof + manual review are Track B's job.
6. Masumi endpoint names/payloads in SHARED-CONTRACT §6 are provisional. Confirm them with the A2 Preprod spike before building on them, and record real routes, tx hashes, fees, deadline gaps and signers in docs/integration-manifest.md. Never claim a live capability from a mock or a doc page.
7. Stay inside Track A's file ownership. Anything crossing the boundary (types, job kinds, order fields, env names) must match SHARED-CONTRACT; add-only changes need a changelog line, changing/removing anything needs Track B's OK.
8. Secrets only in ignored .env files (node secrets in infra/masumi/.env). Ask the founder for credential values; never put them in chat, code, fixtures or logs.
9. Before each merge to mvp-integration: typecheck, contracts:check and test green; never hand-merge docs/generated — run npm run contracts:generate.
10. At the end of the session update docs/handoff/STATUS-A.md (done, in progress, blockers, interface requests) and commit it.
```

## Track B — Ishaan's agent (Evidence & filler)

```text
You are continuing the Global Order Book hackathon MVP in this repository. You own Track B (Evidence & filler).

1. git fetch, check out `mvp-integration`, then create or continue branch `track-b/evidence` and rebase it onto `mvp-integration`.
2. Read, in order: docs/handoff/README.md, docs/handoff/SHARED-CONTRACT.md, docs/handoff/TRACK-B-evidence-filler.md, docs/handoff/STATUS-B.md, docs/handoff/STATUS-A.md. Then docs/03-proof-and-settlement.md and only the other design docs your current task needs.
3. Verify the baseline: npm ci --ignore-scripts && npm run typecheck && npm run contracts:check && npm test.
4. Work the next unfinished task in TRACK-B-evidence-filler.md. Until STATUS-A.md says A0 (Step 0) is merged, edit only the "B-safe before Step 0" files: packages/verification, packages/merchants, fixtures/synthetic, scripts/check-eml.ts and their tests.
5. Decisions already made — do not reopen them: filler places the order manually from their own merchant account (HUMAN_ASSISTED); proof is a DKIM-signed order-confirmation .eml with a per-order nonce in the recipient name, anything not passing goes to buyer manual review (MANUAL); merchant-agnostic verifier with Amazon.in first and Amazon.sg later; verifier runs in our worker (APP_WORKER_DKIM), CRE simulation is stretch; native Masumi settlement belongs to Track A.
6. Use an existing, maintained DKIM library after checking it; do not hand-roll signature verification. Missing key or network failure is INCONCLUSIVE, never PASS. Tests sign synthetic emails with a key generated inside the test. Real .eml files and addresses never enter git, fixtures, logs or chat.
7. Stay inside Track B's file ownership. Anything crossing the boundary must match SHARED-CONTRACT; add-only changes need a changelog line, changing/removing anything needs Track A's OK. Never write funding/escrow/quote/settlement fields and never call Masumi.
8. Before each merge to mvp-integration: typecheck, contracts:check and test green; never hand-merge docs/generated — run npm run contracts:generate.
9. At the end of the session update docs/handoff/STATUS-B.md (done, in progress, blockers, interface requests, B0 findings without personal data) and commit it.
```
