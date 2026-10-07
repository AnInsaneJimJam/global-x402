# Railway + Vercel deployment

## Status and scope

Deployment preparation lives on `codex/railway-vercel-deployment`, based on master `12183ae`.
Frontend and API published on 2026-10-07:

- Frontend: https://ex402.vercel.app (public HTTP 200 verified).
- API: https://global-x402-production.up.railway.app.
- Railway project: `invigorating-miracle`, ID `a6fa62b6-a866-4355-b8e1-ebe12ddd873d`.
- API service: `global-x402`, ID `13a24010-49ee-49a6-8b28-deb4c15b8cd8`.
- App Postgres provisioned, persistent volume ready.
- Direct API health, Vercel-proxied health, and public orders response verified.
- Vercel deployed the prebuilt static assets from this branch via `/tmp/ex402`;
  GitHub auto-deploy for this Vercel project is not configured yet.
- Actor tokens were generated privately and saved to ignored `.local/hosted-app.env`.
  Values are never included here. Do not publish this file.
- Worker service `worker` is provisioned, ID `63786dfe-728a-4c73-b00b-645f0f17cfc6`.
  Database references, CRE simulation mode and API callback settings are configured;
  the service is not running yet, pending private CLI authentication.
- Hosted Masumi and authenticated CRE simulation are **not yet deployed**.
  Full hosted settlement requires the existing node database/wallet cutover and scoped
  credentials, plus CRE CLI authentication. Public site/API readiness does not
  imply live escrow execution.
- Local node inspection found purchasing/selling wallets but an empty V2 registry and
  no payment records. Its active admin/encryption keys differ from `infra/masumi/.env`.
  The active settings were preserved in ignored private storage; a cutover must use
  those settings with the matching database. No node was stopped or chain transaction
  submitted during this inspection.

The owner initially chose free-only usage and later explicitly instructed to deploy
without the spending-limit prerequisite. No paid plan upgrade was performed.

This is the Preprod MVP: operator-held test wallets, bearer-token actor authentication,
verified order placement, and CRE local simulation. Hosting does not turn simulation into
Chainlink DON execution or change the payout condition to delivery.

## Topology

Vercel serves the React frontend and proxies `/v1/*` to the Railway API. The buyer MCP can
use the Railway API HTTPS origin directly. Railway hosts separate API, worker, and Masumi
services. PostgreSQL stores app state and private proof bytes; Masumi uses a separate
PostgreSQL database. Keep Masumi and both databases private. Only the API needs a public
domain. The app does not run a full Cardano node; Masumi connects to Blockfrost Preprod.

Two Postgres services are simplest. If consolidating into one server, create distinct app
and Masumi databases/users before deployment; never let their migrations share a database.
The free Railway plan's service, volume and credit limits may not accommodate this layout.
Choose the spending policy before provisioning any running services.

## 1. Create the Railway project

Create project `ex402-mvp`. Use the GitHub repository root as the source root for every
code service. Initially select the deployment branch above; move to master after this
change is merged. Disable idle/serverless sleeping for the API, worker and Masumi so
escrow observation continues without browser traffic.

Add the app Postgres service and the Masumi Postgres service. Retain their persistent
volumes and configure backups. Do not expose database TCP proxies publicly unless needed
for a controlled data migration. Keep credentials in Railway Variables only.

## 2. API service

Name: `api`. Config-as-code path: `/infra/deploy/railway-api.json`.
Docker build context: repository root. Dockerfile: `infra/deploy/api.Dockerfile`.
The image includes the built dashboard as well as the API. Startup runs app migrations.
Generate a Railway HTTPS domain, with target port matching `PORT`.

Set these variables:

| Variable | Value/source |
|---|---|
| DATABASE_URL | Railway reference to the app Postgres connection string |
| HOST | `0.0.0.0` |
| PORT | `3000`, or the Railway-provided port |
| EVIDENCE_STORAGE | `POSTGRES` |
| DEV_BUYER_TOKEN | Strong unique random secret, entered privately |
| DEV_FILLER_TOKEN | A different strong random secret |
| CRE_VERIFIER_TOKEN | Strong base64url secret, at least 32 characters; same as worker |
| FILLER_MASUMI_URL | Private Masumi URL ending in `/api/v1` |
| VERIFIER | `CRE` when the CRE worker is configured |

Health check: `/v1/health`. It confirms API process startup, not chain settlement or a
live CRE execution. Dashboard sign-in uses the filler bearer token. Never put tokens in
Vercel build variables or frontend bundles.

## 3. Masumi service

Name: `masumi`. Config path: `/infra/deploy/railway-masumi.json`.
Dockerfile: `infra/deploy/masumi.Dockerfile`. It uses the exact same pinned Masumi
0.29.0 runner/source as the local compose setup, restores seeding dependencies, and
runs Prisma migrations before starting. Upstream runtime output is suppressed because
it can contain provider details. Health check: `/api/v1/health`.

Copy only the required settings from ignored `infra/masumi/.env` into Railway Variables,
after the owner selects the wallet migration strategy. Do not print/copy secrets into
docs, CLI arguments visible in logs, fixtures or image layers.

- `DATABASE_URL`: the **Masumi** database, with `?schema=public` if required.
- `ADMIN_KEY`, `ENCRYPTION_KEY`: strong explicit secrets, preserving the original
  encryption key if restoring the original database.
- `BLOCKFROST_API_KEY_PREPROD`.
- `PORT=3001`, `SEED_ONLY_IF_EMPTY=true`, `SEED_V1_LEGACY=false`.
- `BLOCK_CONFIRMATIONS_THRESHOLD=20`.
- `AUTO_WITHDRAW_PAYMENTS=true`, `AUTO_WITHDRAW_REFUNDS=true`.
- For a new seeded database: distinct purchasing/selling Preprod mnemonics and the
  collection wallet address, using names in `infra/masumi/compose.yaml`.

Before seeding a fresh node, decide whether to restore the existing node database and
wallet identities or create/register new test wallets. Do not run two signing nodes with
the same hot wallets simultaneously. A fresh database will not preserve old API keys,
agent registrations or the node's payment-tracking records. Restore its database together
with its original encryption key if retaining those identities. Validate on-chain state
before enabling automatic payout processing.

For fresh setup, run `node /opt/gob/prisma-tool.mjs seed` inside the Masumi container once.
Use the existing `scripts/masumi-setup.ts` only after adjusting its private local settings
for the hosted node; it writes scoped tokens into ignored `.env`. It may register an agent
on-chain, so do not blindly rerun it against restored identities. The local token-setup
flow requires access to the node through a controlled private tunnel or an SSH/container
session; keep the Masumi admin API off the public Internet.

## 4. Worker service

Name: `worker`. Config path: `/infra/deploy/railway-worker.json`.
Dockerfile: `infra/deploy/worker.Dockerfile`. It includes Node, Bun 1.3.14,
checksum-verified CRE CLI 1.37.0, and locked workflow dependencies. No public domain or
HTTP health check. Keep one worker replica for this MVP.

| Variable | Value/source |
|---|---|
| DATABASE_URL | Same app Postgres as API |
| EVIDENCE_STORAGE | `POSTGRES`, same as API |
| BUYER_MASUMI_URL | Private Masumi origin plus `/api/v1` |
| FILLER_MASUMI_URL | Same node URL |
| BUYER_MASUMI_TOKEN | Purchasing-wallet scoped secret |
| FILLER_MASUMI_TOKEN | Selling-wallet scoped secret |
| FILLER_AGENT_IDENTIFIER | Actual registered seller identity |
| VERIFIER | `CRE` for the CRE simulation path |
| CRE_API_URL | API HTTPS **origin**, without `/v1` or credentials |
| CRE_VERIFIER_TOKEN | Same secret as API |
| CRE_API_KEY | Optional headless API key entered privately |
| CRE_SESSION_YAML_B64 | With browser login: private base64 of `~/.cre/cre.yaml` |
| CRE_CONTEXT_YAML_B64 | With browser login: private base64 of `~/.cre/context.yaml` |
| ESCROW_PAY_WINDOW_MIN | `25` |
| ESCROW_RESULT_WINDOW_MIN | `45` |

CRE API-key authentication currently requires approved deploy access. Obtain the key in
the CRE organization API settings; this is distinct from `CRE_VERIFIER_TOKEN`, which
protects our callback endpoints. If the owner cannot obtain CRE API-key access, hosted
CRE simulation can instead use browser login: run `cre login`, then transfer both session
files privately into the two Railway secret variables above. Treat both files as secrets;
never commit them, put them in the image, or paste their contents into chat. Browser
sessions can expire; reauthenticate and replace the variables when that happens. No
Chainlink network workflow deployment is needed for this simulation-only setup.
Without either authentication method, CRE execution remains blocked; do not silently
switch the verifier or claim CRE runs.
A direct DKIM worker is available only by explicitly choosing `VERIFIER` unset, and its
results are labelled `APP_WORKER_DKIM` rather than `CRE_SIMULATION`.

The startup wrapper creates a mode-0600 temporary env file for the simulator and updates
its staging config to the hosted API origin. CLI auth uses `CRE_API_KEY` or restores the
two browser-session files under the worker's home directory with mode 0600.
This image is Linux x86-64; do not deploy it to ARM without changing the CLI binary.
End-to-end CRE simulation in Railway still needs a real authenticated smoke run.

## 5. Vercel frontend

Import the same GitHub repository, use repository root, and choose Framework Preset
**Other**. `vercel.json` supplies the install/build commands. Leave Output Directory
unset: `scripts/build-vercel.mjs` emits Vercel Build Output API v3 into `.vercel/output`.
Set `RAILWAY_API_ORIGIN` to the API's actual HTTPS origin in the selected Vercel
environment. It is public routing configuration, not a secret. Redeploy after changing it.

The script refuses missing/non-HTTPS origins and origins with credentials, paths, queries
or fragments. It builds static assets and emits an external `/v1/*` proxy, preserving the
existing same-origin client and bearer-auth flow. API responses have `Cache-Control:
no-store` at the proxy route. Hash navigation needs no server-side route handling.

Never expose the buyer, filler, Masumi or CRE secrets as VITE_* variables. Vercel Hobby
is restricted to personal non-commercial use; select a suitable plan for the deployment.

## 6. Validate and cut over

1. API `/v1/health` and `/v1/capabilities` return successfully over HTTPS.
2. Vercel `/v1/health` reaches that same API; session authentication works with the
   actual actor tokens, and wrong/missing tokens fail.
3. Post a bounded Preprod test intent and claim it. No merchant checkout before
   confirmed funding. Observe worker jobs and confirmed chain transactions.
4. Submit a synthetic proof in a non-paying test flow first; verify API/worker share
   PostgreSQL-backed evidence. Do not use a synthetic email to authorise real payouts.
5. With real credentials, perform the approved Amazon.in order-placement proof flow
   and confirm the callback, result submission and eventual payout on-chain.
6. Exercise refund/review and restart both API and worker; confirm state/evidence persist.
7. Update the buyer MCP's GOB_API to the hosted API and configure wallet-scoped secrets
   locally. Keep the buyer spending policy and confirmation flow.

Existing local `.evidence` files are **not** automatically uploaded/backfilled into
PostgreSQL. Fresh hosted orders use database storage. An existing-data cutover requires
an explicit private evidence migration and retention decision before abandoning old disks.
Backups now contain merchant emails/addresses: restrict access and set a retention policy.

## Verification and sources

Verified locally on 2026-10-07:

- Typecheck passed.
- All 57 tests passed, including the new hosted-evidence regression.
- Vercel Build Output v3 generation and proxy route checked with a test HTTPS origin.
- API, worker and Masumi Docker images built successfully.
- Worker container: CRE 1.37.0, Bun 1.3.14, workflow write permission and module loading passed.
- Simulation auth wrapper: missing authentication blocks startup; fixture browser-session
  files restore with mode 0600 and reach the worker's database preflight. These fixture
  checks are not an authenticated CRE simulation.

Local checks and image builds are distinct from a live hosted smoke test. No public URLs,
CRE authenticated simulation or on-chain hosted capability are claimed until verified.

- Railway config: https://docs.railway.com/config-as-code/reference
- Railway persistent storage: https://docs.railway.com/volumes/reference
- Vercel Build Output API: https://vercel.com/docs/build-output-api
- CRE authentication: https://docs.chain.link/cre/account/managing-auth
- CRE binary release: https://github.com/smartcontractkit/cre-cli/releases/tag/v1.37.0
