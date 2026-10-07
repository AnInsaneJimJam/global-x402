# Development runbook

This is the first executable slice of Milestone 1E, not a finished escrow marketplace. It runs a real PostgreSQL control service with synthetic external observations. Payment, merchant and verifier identities are MOCK; fiat purchases, chain transactions, authoritative merchant proof, CRE and wallet authentication are unavailable.

## Setup and verification

Requirements: Node.js 22+, npm, PostgreSQL server binaries (including `initdb`, `pg_ctl`, and `pg_config`), and a non-root Unix user. No Cardano wallet or merchant credential is needed for these fixtures.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run contracts:check
npm test
```

Without `TEST_DATABASE_URL`, tests create a disposable UTF-8 PostgreSQL cluster with a private Unix socket and no TCP listener, run the tests, then stop/delete that task-owned cluster. Set `PG_BIN` if `pg_config` points at the wrong installation. With `TEST_DATABASE_URL`, each database-backed test creates and drops its own randomly named schema; it never truncates the shared development schema. That database role needs permission to create schemas.

## Run the local fixture demonstration

Start a dedicated development database. For an installed PostgreSQL 16 distribution whose binaries are not on PATH:

```sh
mkdir -p .local
$(pg_config --bindir)/initdb -D .local/postgres --encoding=UTF8 --auth-local=trust --auth-host=trust -U gob_dev
$(pg_config --bindir)/pg_ctl -D .local/postgres -l .local/postgres.log -o '-h 127.0.0.1 -p 55432 -k /tmp' start
createdb -h 127.0.0.1 -p 55432 -U gob_dev global_x402
cp .env.example .env
```

Set `DATABASE_URL=postgresql://gob_dev@127.0.0.1:55432/global_x402` in the ignored `.env`. The development database is localhost-only and uses trust authentication; it is unsuitable for remote deployment.

```sh
npm run db:migrate
npm run demo
```

The demo creates an intent, reserves a filler, injects a claim-bound funding fixture, simulates placement followed by a lost response, stops the run, and restores a fresh runtime that reconciles the existing purchase. Its JSON reports UNKNOWN → ORDERED with one checkout call and explicitly unavailable verification/settlement. It does not buy anything. It leaves synthetic records in the development database and removes its temporary actor journal after this resolved fixture.

To run the HTTP API, set distinct `DEV_BUYER_TOKEN` and `DEV_FILLER_TOKEN` locally in `.env`, then run `npm run dev`. These are local development sessions, not wallet-signature authentication. The API binds to `127.0.0.1`; tokens are not logged. It exposes no funding-injection endpoint. Use [the generated quickstart](generated/agent-quickstart.md) and the reference `ControlClient` for the finite command routes.

Stop the dedicated database when done:

```sh
$(pg_config --bindir)/pg_ctl -D .local/postgres -m fast stop
```

## Boundaries and recovery

The API and fixture share `Procurement` handlers. PostgreSQL serializes competing claims and business operations. Client-order IDs, transport keys, purchase-operation bindings, and merchant-order references have persistent uniqueness constraints. Preparation stores a plan; it does not claim, spend or purchase. Commit checks role, plan owner, named route, decision version, expiry and exact business-effect hash.

The filler runtime journals a purchase before checkout and uses a single executor lock per run. UNKNOWN/SUBMITTING and already ORDERED attempts block replacement purchases. Missing/corrupt local state blocks checkout. An actor-reported failure is insufficient to permit a replacement. Stopping blocks new checkout while reconciliation remains available.

A process killed while holding a run lock leaves a visible lock blocker. This prototype requires confirming the old executor is dead and reconciling the registered operation before manually clearing that actor-owned lock; automatic lease takeover and cross-device handoff are not implemented. The restart fixture replaces the runtime after a recorded UNKNOWN outcome, not during an unjournaled in-flight process kill.

Current limitations include absent wallet auth, real quote/fee enforcement, native funding/settlement/refunds/disputes, monitoring deadlines, event cursors, full acquisition-goal reservations, independent verification, and the dashboard. Ranking is a pure exact-integer comparison over supplied comparable quotes; the complete concurrent goal ledger is still future work. The prototype checkout grant is a local fixture boolean, not an enforceable wallet/card policy.

Generated command/plan/receipt schemas and the compact agent guide come from runtime definitions. `npm run contracts:check` catches drift. The public capability response names the local scope and live blockers; no synthetic result upgrades a live integration gate.
