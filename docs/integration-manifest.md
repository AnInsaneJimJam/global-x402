# Integration manifest — initial implementation

Recorded 7 October 2026. Architecture A and placement-based completion remain selected. This file reports implementation evidence; it does not redefine the product or attest to external capabilities.

## Implemented slice

| Surface | Current evidence / limitation |
|---|---|
| Runtime contracts | Strict Zod commands, plan/receipt validation, generated schemas and role guide, typed reference client. |
| Procurement | Real PostgreSQL transactions; prepared commands; role/owner/route/version/expiry checks; durable operation and transport deduplication; atomic claims and purchase registration; merchant-order uniqueness. |
| Actor runtime | Actor-local durable journal; one run executor; fixture checkout; uncertain-result reconciliation; stop/resume; missing-state blockers. Not a complete buyer/filler goal runner. |
| Opportunity policy | Exact-integer ratio ranking, comparable units, hard cost/target/deadline filters and stable ties. Pending target capacity included in supplied policy; shared concurrent goal reservations not yet implemented. |
| HTTP | Fastify on localhost; named finite command routes, redacted opportunities, owned work pagination, control/operation reads; development bearer sessions. No wallet authentication or privileged fixture-funding route. |
| External systems | Payment MOCK / declared X402_MASUMI on Preprod; merchant MOCK; verifier MOCK. No actual native transaction, purchase, independently verified placement or CRE run. |

Implementation entry points: `packages/contracts`, `packages/procurement`, `packages/agent-runtime`, `apps/api`, `fixtures`, `examples/control-demo.ts`. The [runbook](08-development.md) describes exact commands and limitations.

## Installed coding skills

| Source | Pinned revision | Installed skills |
|---|---|---|
| [Cardano Foundation](https://github.com/cardano-foundation/cardano-dev-skills/tree/8c8005aff19260383de24191bddbe476c670b410) | `8c8005aff19260383de24191bddbe476c670b410` | build-transaction, query-chain, debug-transaction, connect-wallet |
| [Masumi Network](https://github.com/masumi-network/masumi-skills/tree/3eabe4a243dfd3ee326a105736215eeb0d83c787) | `3eabe4a243dfd3ee326a105736215eeb0d83c787` | masumi |

Installed through Codex's skill-installer helper using Git after archive downloads stalled. Cardano skills retain their relative bundled documentation under the companion skill-source directory; discoverable Codex entries point to those preserved skill directories. Masumi uses its own packaged references. They become available in the next turn. Source guidance is checked against pinned upstream code; broad performance, automatic-refund or compliance claims in a skill are not project evidence.

## Live payment compatibility inspection

Inspected the published `@x402/cardano@2.28.0` package without installing/executing it in the application. npm tarball SHA-1: `74aaff1d117fe76f36b11b8c77992b7979cc2958`. Its README still explicitly documents that seller authorization uses a different digest from `masumi-payment-service`, preventing the stock node from driving that lock's lifecycle. Result submission/refunds/disputes need x402-aware tooling with the actual seller authority. [Versioned npm package](https://www.npmjs.com/package/@x402/cardano/v/2.28.0).

G1/G3 therefore remain open. The compatibility inspection is not a lock/release/refund test and does not trigger an automatic native-Masumi fallback. No SDK is included in the runtime merely to create the appearance of live support.

## Merchant access

The founder has no merchant API access yet and is willing to obtain free or inexpensive access. Amazon Business is the first onboarding candidate, not a selected working adapter. [The merchant follow-up](research/merchant-options.md) separates free account registration, API role approval, sandbox availability and live order evidence. eBay checkout requires approval even in sandbox. No access application, paid subscription or real purchase has been submitted by this implementation.

## Verification record

- `npm run typecheck`: PASS with strict TypeScript checks.
- `npm run contracts:check`: PASS for generated command, plan, receipt and control-view schemas plus the role quickstart.
- `npm test`: PASS, 16 tests, zero failures or skipped cases. Database-backed cases used isolated schemas in a disposable PostgreSQL 16 cluster with a private Unix socket; the cluster was stopped and removed by the test script.
- `npm run demo` against a dedicated disposable development database: PASS, UNKNOWN → actor-reported ORDERED, exactly one checkout call, stopped run still reconciled, 1,467-byte decision view. Verification and settlement remained NOT_IMPLEMENTED.
- Generated quickstart: 1,615 UTF-8 bytes. These are one fixture's measured sizes, not general performance guarantees.
- Dependency install audit: zero reported vulnerabilities at initial installation; lifecycle scripts were disabled. This is not a security audit of the application.

All external behavior tested is fixture behavior. G7 has partial evidence; G1–G6 and full G7 remain open. No claims of full 58-scenario coverage, native refund support or a completed MVP.
