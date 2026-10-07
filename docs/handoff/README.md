# Two-track split — start here

Prepared 7 October 2026 for a two-person team. The remaining MVP work is split into two tracks that touch different files, meet at one written contract, and merge into one integration branch.

| Track | Owner | Document | Status log |
|---|---|---|---|
| **A — Settlement & chain** (Masumi node, Preprod escrow, worker, quote/fees, buyer runner) | Teammate (AnInsaneJimJam) | [TRACK-A-settlement.md](TRACK-A-settlement.md) | [STATUS-A.md](STATUS-A.md) |
| **B — Evidence & filler** (DKIM verifier, merchants, nonce/assignment, evidence upload, manual review, filler agent, dashboard, CRE) | Ishaan | [TRACK-B-evidence-filler.md](TRACK-B-evidence-filler.md) | [STATUS-B.md](STATUS-B.md) |
| Shared boundary (both read, changes by agreement only) | Both | [SHARED-CONTRACT.md](SHARED-CONTRACT.md) | Changelog inside it |
| Prompts for each person's coding agent | Both | [AGENT-PROMPTS.md](AGENT-PROMPTS.md) | — |

## Reading order for a fresh agent

1. This file.
2. [SHARED-CONTRACT.md](SHARED-CONTRACT.md): decisions, flow, Step 0, interfaces, boundary, environment names.
3. Your track document, then the other track's STATUS file (to see what already landed).
4. Only then the design docs your current task needs: [00 decisions](../00-decisions.md), [07 agent system](../07-agent-system.md), [03 proof](../03-proof-and-settlement.md) (Track B), [02 architecture](../02-architecture.md) and [masumi research](../research/masumi-x402.md) (Track A), [04 API/data](../04-api-and-data.md) for field meanings. [HANDOFF.md](../HANDOFF.md) describes the code that existed before this split.

## Branches and merge protocol

- `mvp-integration` is the shared branch, cut from upstream `feature/agent-control-recovery` plus this handoff. Nobody commits directly to it except merges.
- Track A works on `track-a/settlement`. Track B works on `track-b/evidence`. Both are cut from `mvp-integration`.
- **Step 0 lands first.** Track A owns it (see SHARED-CONTRACT §3). Until Step 0 is merged, Track B edits only files listed as "B-safe before Step 0" in its track document.
- Merge small and often: open a PR into `mvp-integration` per finished task. Rebase your track branch onto `mvp-integration` at the start of each session.
- Before every merge, all three must pass: `npm run typecheck`, `npm run contracts:check`, `npm test`.
- `docs/generated/*` is never hand-merged. After resolving any merge, run `npm run contracts:generate` and commit the result.
- A change to anything in SHARED-CONTRACT (types, job kinds, table columns, env names) needs a changelog line there **and** a note to the other person. Add-only changes (a new optional field, a new job kind) may land without waiting; changing or removing an existing field waits for the other person's OK.
- Update your STATUS file at the end of every working session: done, in progress, blockers, interface requests.

## Ground rules that apply to both tracks

- Real secrets live only in ignored `.env` files. Real Amazon emails (`.eml`) and real addresses are never committed; tests use synthetic emails signed with a test-generated DKIM key.
- Keep labels honest. Use the `IntegrationIdentity` values in SHARED-CONTRACT §2; a mock or manual step is never shown as live/automatic.
- Every order mutation goes through the locked order read inside a transaction and increments `version` (existing pattern in `packages/procurement/service.ts`).
- Dashboard and CRE simulation are **stretch**. The critical path is: Step 0 → Preprod lifecycle → adapter + observer → verifier → worker wiring → buyer/filler runners → failure tests → demo.
