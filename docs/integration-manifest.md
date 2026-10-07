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
| External systems | Payment MOCK / declared MASUMI_NATIVE on Preprod, with operator-held test-wallet custody; merchant MOCK; verifier MOCK. No actual native transaction, purchase, independently verified placement or CRE run. |
| A0 foundation | Numbered idempotent migrations, per-command handlers, v0.2 contract vocabulary, and a transactional outbox with leased worker dispatch. No production job kind is registered yet. |

Implementation entry points: `packages/contracts`, `packages/procurement`, `packages/agent-runtime`, `apps/api`, `fixtures`, `examples/control-demo.ts`. The [runbook](08-development.md) describes exact commands and limitations.

## Installed coding skills

| Source | Pinned revision | Installed skills |
|---|---|---|
| [Cardano Foundation](https://github.com/cardano-foundation/cardano-dev-skills/tree/8c8005aff19260383de24191bddbe476c670b410) | `8c8005aff19260383de24191bddbe476c670b410` | build-transaction, query-chain, debug-transaction, connect-wallet |
| [Masumi Network](https://github.com/masumi-network/masumi-skills/tree/3eabe4a243dfd3ee326a105736215eeb0d83c787) | `3eabe4a243dfd3ee326a105736215eeb0d83c787` | masumi |

Installed through Codex's skill-installer helper using Git after archive downloads stalled. Cardano skills retain their relative bundled documentation under the companion skill-source directory; discoverable Codex entries point to those preserved skill directories. Masumi uses its own packaged references. They become available in the next turn. Source guidance is checked against pinned upstream code; broad performance, automatic-refund or compliance claims in a skill are not project evidence.

## Live payment compatibility inspection

Inspected the published `@x402/cardano@2.28.0` package without installing/executing it in the application. npm tarball SHA-1: `74aaff1d117fe76f36b11b8c77992b7979cc2958`. Its README still explicitly documents that seller authorization uses a different digest from `masumi-payment-service`, preventing the stock node from driving that lock's lifecycle. Result submission/refunds/disputes need x402-aware tooling with the actual seller authority. [Versioned npm package](https://www.npmjs.com/package/@x402/cardano/v/2.28.0).

The selected MVP flow now uses native Masumi rather than x402. This historical compatibility inspection is not a native lock/release/refund test. A2 must establish real lifecycle behavior before the app treats any settlement action as live. No SDK is included in the runtime merely to create the appearance of live support.

## Merchant access

The founder has no merchant API access yet and is willing to obtain free or inexpensive access. Amazon Business is the first onboarding candidate, not a selected working adapter. [The merchant follow-up](research/merchant-options.md) separates free account registration, API role approval, sandbox availability and live order evidence. eBay checkout requires approval even in sandbox. No access application, paid subscription or real purchase has been submitted by this implementation.

## A1 — Masumi Preprod deployment

The [node runbook](../infra/masumi/README.md) and Compose deployment are implemented.
One node holds distinct purchasing/selling test wallets, labeled
`OPERATOR_HELD_TEST_WALLETS`. It has its own persistent Postgres database, explicit
admin/encryption secrets, localhost-only HTTP, a guarded seed wrapper, and offline
wallet phrase generation. Secrets remain in ignored `infra/masumi/.env`; only
public observations belong here. The app remains `MOCK`.

| Item | Pin / evidence |
|---|---|
| Masumi source | [tag 0.29.0](https://github.com/masumi-network/masumi-payment-service/tree/0.29.0), fetched and checked out at `71455701ac22c3380c50da54089e1b7363f6825d` |
| Official image | `ghcr.io/masumi-network/masumi-payment-service@sha256:c7408906637858f121667e8e7fd973f2bda26c183eefc67eecacf9c09bf36ed9`; tag-to-digest inspected remotely; amd64 selected; OCI revision label matches source commit, built `2026-10-05T17:44:51Z` |
| Database image | `postgres:16.13-bookworm@sha256:472efd9a66f2b2f1a5aeb18b28de74332e6ef88c2b93a1a5d812fb6db67a5f60` |
| Tooling overlay | `local/gob-masumi-preprod:0.29.0-tooling`; restores exact source workspace files, relinks frozen dependencies offline with pnpm 10.30.2, lifecycle scripts disabled; build PASS |
| Local tooling | Docker Engine 29.4.3, Compose v5.1.3, Node 22.22.1 |
| Local secrets | Generated into ignored file, permissions 0600; repeated init preserves values |
| Database startup | Pinned image pulled; isolated `gob-masumi-preprod-postgres-1` is healthy, no published database port |
| Node startup | Migrations PASS; offline native import check PASS; HTTP health 200 / `ok`; container healthy on `127.0.0.1:3001` |
| Wallet generation | Two distinct addresses derived offline; repeat-run preservation checked separately from seeding/funding |
| Seed guard | Missing provider key correctly rejected before upstream execution; unseeded wallet API returns 401, as expected |
| Provider | Founder configured Preprod project key locally; successful public asset and address queries |
| Node seed | PASS; one native V2 Preprod source and two test wallets imported; wallet-list HTTP 200 |
| Purchasing wallet | Node-imported address matches offline derivation; **205 tADA / 200 tUSDM** observed at `2026-10-07T08:06:16.419Z` |
| Selling wallet | Node-imported address matches offline derivation; **205 tADA / 200 tUSDM** observed at `2026-10-07T08:06:16.419Z` |
| Filler registry | Agent ID/registration transaction **UNOBSERVED**; V2 registration template prepared, not submitted |

Public addresses generated offline on 7 October 2026 (not funding evidence):

- Purchasing: `addr_test1qppw23czpf0qef8djjveuld582wauph9ysdlz0f33xx8ytyvxwyr2y4yzpclvz24zzqyez002mqus44g2fc2cxk7tjuqye5l5y`
- Selling: `addr_test1qq6layjq247zdm72qta5mgxg5nl0qfs9hednu7jnll5ac82qyn8ml2z9tqeak5re2h7mrsc3mw7gp8uv34pppvqfe4dqfjuar2`

Observed node source ID: `cmuxtg6w6000423k71r9i21sa`. Purchasing wallet ID
`cmuxtg6w8000823k7qop8ioxf`, payment key hash
`42e547020a5e0ca4ed94999e7db43a9dde06e5241bf13d31898c722c`.
Selling wallet ID `cmuxtg6w8000923k7atgs2ivc`, payment key hash
`35fe9240557c26efca02fb4da0c8a4fef02605be5b3e7a53ffe9dc1d`.
These IDs are local node records, not on-chain agent identifiers.
Founder reported the official faucet's rate limit, then funded both wallets via
the Masumi dispenser. Blockfrost Preprod now reports `205000000` lovelace and
`200000000` tUSDM base units on each wallet; this is observed funding, separate
from any escrow lifecycle. The dispenser requires a registration-email verification
code and offers separate ADA collateral.

Public funding outputs observed via Blockfrost Preprod (all output index 0;
these are dispenser funding references, not native escrow lifecycle evidence):

| Wallet | ADA/tUSDM output | Additional ADA/tUSDM output | Separate 5 tADA output |
|---|---|---|---|
| Purchasing | `08a04cba2c39f78b4ccce90175b2d0f812bf7348e050484064e277ecfa0937c1` | `01b18db7659524227a0178743a3008bb067d62e99015f5d6a236b3a0da8778a2` | `78c4f70fc1f8b56c04c84028ae599568dd12a940da99e038809331725a562245` |
| Selling | `f76b8731e23e01f345c52c2384c24cdd9a472d1df451526f5c12e1aacc6b3a2e` | `ca7e53c639abf325b0ba4873c4669edd55f990edb7dd32b293ab7c9d83681e77` | `a15a6ee056c05917d49a5c1e49fec0faf236958b95814d9485218b371cc91b7d` |

The official runner's missing `packages/payment-core` caused the native preflight
to fail with `MODULE_NOT_FOUND` / `ERR_PACKAGE_PATH_NOT_EXPORTED`. Its globally
installed pnpm 12.9.1 also attempted a package-manager download in the offline
check. The tested overlay restores source files from the matching commit and
installs pnpm 10.30.2 for frozen offline relinking. Startup/migration/preflight
invoke installed Node tools directly. The upstream application and contract
source are unchanged. A verified local source context replaced a slow remote
BuildKit Git fetch. Build contexts exclude the node secret file.

Source inspection of the pinned release identifies candidate tUSDM policy
`16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde` and asset-name hex
`0014df10745553444d`. App asset ID:
`16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde.0014df10745553444d`.
At `2026-10-07T07:58:55.658Z`, `manage.mjs asset` successfully read the Preprod asset:
fingerprint `asset1mtjjpvfgtuxq3n872ptulrs25j0k4t8nd2pp2k`, token-registry metadata
**decimals = 6**. This is observed metadata, distinct from validator-enforced base
unit quantities; the helper reports absent metadata explicitly.
The [Masumi wallet guide](https://www.masumi.network/dev/masumi/core-concepts/wallets)
links [dispenser.masumi.network](https://dispenser.masumi.network) for test tokens;
actual dispensing has not been observed. tADA funding uses the official
[Cardano Preprod faucet](https://docs.cardano.org/cardano-testnet/tools/faucet/).

The source-selected V2 escrow script is
`addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g` and registry
policy is `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b`.
These are **source-inspected**, not independently observed deployment or lifecycle
evidence. `/api/v1/health`, `/api/v1/wallet/list`, and V2 registry metadata shapes
were inspected in source; SHARED-CONTRACT §6 settlement routes remain provisional
until A2. Actual transaction hashes, fees, deadline gaps, signers, scoped-token
isolation and refund behavior are **NOT TESTED**.

Provider alternative inspected after the founder asked about NowNodes:
its [Blockfrost-compatible API](https://docs.nownodes.io/ada/blockfrost/) uses an
`api-key` header, while stock Blockfrost uses `project_id`. The current
[NowNodes endpoint catalogue](https://nownodes.io/nodes) lists Cardano Mainnet;
Preprod support was not established. The pinned Masumi `RPCProvider` enum contains
only Blockfrost. No provider switch or compatibility proxy is implemented.

## Verification record

- `npm run typecheck`: PASS with strict TypeScript checks.
- `npm run contracts:check`: PASS for generated command, plan, receipt and control-view schemas plus the role quickstart.
- `npm test`: PASS, 18 tests, zero failures or skipped cases after A0, including outbox lease/dispatch/deduplication and delayed-retry tests. Database-backed cases used isolated schemas in a disposable PostgreSQL 16 cluster with a private Unix socket; the cluster was stopped and removed by the test script.
- `npm run demo` against a dedicated disposable development database: PASS, UNKNOWN → actor-reported ORDERED, exactly one checkout call, stopped run still reconciled, 1,467-byte decision view. Verification and settlement remained NOT_IMPLEMENTED.
- Generated quickstart: 1,615 UTF-8 bytes. These are one fixture's measured sizes, not general performance guarantees.
- Dependency install audit: zero reported vulnerabilities at initial installation; lifecycle scripts were disabled. This is not a security audit of the application.

Procurement payment/merchant behavior tested remains fixture behavior; infrastructure checks are recorded separately above. G7 has partial evidence; G1–G6 and full G7 remain open. No claims of full 58-scenario coverage, native refund support or a completed MVP.

## Live Preprod evidence — this machine (2026-10-07)

| Observation | Evidence |
|---|---|
| Node | Masumi payment service 0.29.0 (teammate's pinned overlay), seeded native V2 Preprod source, healthy on `127.0.0.1:3001`. |
| Wallets | Fresh purchasing `addr_test1qrdrnt9z…u5x9g` and selling `addr_test1qqtefm35…x4shtm`, funded from the Masumi dispenser (tADA + tUSDM; testnet needs no verification code). |
| API keys | `POST /api-key` requires `UsageCredits` even when `usageLimited=false` (fixed in `scripts/masumi-setup.ts`). Keys scoped to one hot wallet each, Preprod only. |
| Registry | `GET /registry` defaults to V1 sources — must pass `filterPaymentSourceType=Web3CardanoV2`. Filler agent confirmed: `67ab0c92…b7000000`. |
| Escrow terms | `POST /payment` (seller key) accepted ISO times and returned the V2 payment request. |
| Buyer lock | `POST /purchase` (buyer key) accepted ms-epoch times; the batch job locked **both** test escrows in one tx: [`663c26dc…62c7a6`](https://preprod.cardanoscan.io/transaction/663c26dc5974005e697b63350565c7aa24f911083f5bc52bece2b30ea862c7a6), block 5264091, 10:41:17Z. The node marked it `Pending` for several minutes after chain confirmation (sync lag). |
| Amazon.in DKIM | Fresh order confirmation (10:39Z): `d=amazon.in` and `d=amazonses.com` both **pass** with live keys; no `l=`. Full verifier: all checks pass except the nonce — Amazon.in shows **only the first word of the recipient name**, so the code must be the first word (`GOB-XXXXXX Name`). Code changed accordingly. |
