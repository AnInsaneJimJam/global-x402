# A1 — local Masumi Preprod node

This is one operator-held test node for buyer purchasing and filler selling wallets:
`OPERATOR_HELD_TEST_WALLETS`, `cardano:preprod`, native Masumi/MIP-003. The app
continues to report payment execution as `MOCK` until A2 and the adapter/observer
actually establish chain behavior. A healthy node alone does not prove escrow works.

## Pins and prerequisites

- Git, Docker Engine with BuildKit and Compose v2.17+ (named build contexts);
  Node.js 22+ for the local helper.
- Official Masumi image advertised as `0.29.0`, pinned to digest
  `sha256:c7408906637858f121667e8e7fd973f2bda26c183eefc67eecacf9c09bf36ed9`.
  Platform is `linux/amd64`; other hosts need Docker emulation.
- The node/seed image is a local tooling overlay on that official image. The
  published runner omits native workspace sources needed by seeding. `Dockerfile`
  restores the matching commit's packages and frozen lockfile, then relinks with
  pinned pnpm 10.30.2 and lifecycle scripts disabled. No application/contract code
  is patched. The official image is still used directly for offline wallet generation.
- [Source tag 0.29.0](https://github.com/masumi-network/masumi-payment-service/tree/0.29.0)
  resolves to `71455701ac22c3380c50da54089e1b7363f6825d`. Image provenance labels
  and startup checks must be recorded separately from source inspection.
- PostgreSQL `16.13-bookworm`, pinned to multiarch digest
  `sha256:472efd9a66f2b2f1a5aeb18b28de74332e6ef88c2b93a1a5d812fb6db67a5f60`.
- A [Blockfrost](https://blockfrost.io) **Preprod** project key. Obtain it in your
  account, then edit the local file below; do not send its value in chat.

Run commands from the repository root. Every Compose invocation uses the same
explicit env file and compose file; do not use a plain root `docker compose up`.
Port 3001 must be available. The procurement app remains on port 3000.

## 1. Generate local secrets and wallet phrases

```sh
node infra/masumi/manage.mjs init
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml pull postgres wallet-init
bash infra/masumi/prepare-source.sh
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml build masumi
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml run --rm --no-deps preflight
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml run --rm --no-deps wallet-init
```

`init` creates ignored `infra/masumi/.env` with random Postgres, admin and encryption
secrets, mode 0600. It preserves an existing file. `wallet-init` uses the pinned
image's Mesh generator with networking disabled and writes two distinct 24-word
phrases directly into that file. Existing phrases are preserved. No phrase or
credential value is printed. Public addresses are printed as `OFFLINE_DERIVED_ONLY`;
this does not prove the node imported the wallets or that they have funds.
Keep a private backup of the file; the database's
encrypted wallets depend on its encryption key. Do not rotate keys or regenerate
wallets against an existing volume as a recovery shortcut.

`preflight` imports native contract-generation modules with networking disabled.
It checks the published image's runtime dependencies before any seed or chain
operation through the tooling overlay. Stop if it fails; source inspection cannot
substitute for this check. Runtime startup/migrations invoke installed Node tools
directly: the official runner bundles pnpm 12.9.1, which otherwise attempts a
package-manager download. The build context excludes the local `.env` entirely.
`prepare-source.sh` keeps a public, clean, commit-checked checkout in ignored
`infra/masumi/.local/upstream`; it refuses to overwrite a different or dirty checkout.
Run it before each build. Do not edit or install dependencies in that source cache.

Edit `BLOCKFROST_API_KEY_PREPROD` in that file locally. Leave
`COLLECTION_WALLET_PREPROD_ADDRESS` blank for the seed's selling-wallet default,
or set a public **Preprod** collection address you control before seeding.

```sh
node infra/masumi/manage.mjs check
git check-ignore infra/masumi/.env
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml config --quiet
```

`check` reports names and set/missing status only. Exit 1 means setup is incomplete
or a guard failed. The generated database password is URL-safe; imported passwords
must be URL-safe too. Set `ADMIN_KEY` explicitly: upstream seed otherwise uses
`DefaultUnsecureAdminKey`. Do not run the upstream seed directly with empty
mnemonics: it prints the phrases it generates.

## 2. Migrate, seed and start

```sh
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml up -d --wait postgres
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml run --rm migrate
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml run --rm seed
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml up -d --wait masumi
node infra/masumi/manage.mjs status
```

Seed creates the native V2 Preprod payment source and purchasing/selling wallets.
Only the Preprod credential is injected: no Mainnet provider, EVM wallets, or
legacy V1 seed. `SEED_ONLY_IF_EMPTY=true` prevents replacing an existing setup;
it does not guarantee partially failed seeds can safely be rerun. Inspect the
public status and admin UI before retrying a failed seed. If you add the provider
key after an unseeded local startup, complete seeding and recreate the service:

```sh
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml up -d --force-recreate --wait masumi
```

Open `http://127.0.0.1:3001` for the admin UI and use the local admin key there.
`status` calls `/api/v1/health` and `/api/v1/wallet/list?take=100`, never the wallet
secret endpoint. It prints public wallet IDs, addresses, verification keys and
asset balances from Blockfrost. An empty balance array means the address has no
observed assets; `null` means the provider is not configured. `addr_test1` alone
cannot distinguish Preview from Preprod; balances are read specifically from
the Preprod endpoint. Health plus an empty wallet list is an **unseeded** node.
Before seeding, authenticated wallet reads return HTTP 401 because the admin key
has not yet been inserted. After a successful seed, 401 requires checking the
local key against the existing database; do not regenerate keys as a workaround.

## 3. Fund both wallets and inspect the asset

Use the purchasing and selling addresses reported by `status`:

1. Request tADA for **each** address at the official
   [Cardano testnet faucet](https://docs.cardano.org/cardano-testnet/tools/faucet/),
   selecting Preprod. Both actors need ADA for fees; the selling wallet also needs
   ADA for registration. Observe balances rather than assuming a faucet click succeeded.
2. Obtain tUSDM from the [Masumi dispenser](https://dispenser.masumi.network),
   linked by the official [wallet guide](https://www.masumi.network/dev/masumi/core-concepts/wallets).
   Dispenser availability and any eligibility requirements must be checked live.
   Fund the purchasing wallet for A2 token-payment tests. Selling receives token
   payments later; it need not hold tUSDM to demonstrate a funded fee wallet.
3. Re-run `status` until nonzero lovelace appears on both wallets and the expected
   test asset appears on the purchasing wallet. Record public output in the manifest.

```sh
node infra/masumi/manage.mjs status
node infra/masumi/manage.mjs asset
```

The pinned source names the following candidate asset:

| Field | Candidate value — verify before quoting |
|---|---|
| Policy | `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde` |
| Asset-name hex | `0014df10745553444d` |
| Masumi/Blockfrost unit | `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d` |
| App asset ID | `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde.0014df10745553444d` |
| Decimals | **6**, observed in Preprod token-registry metadata on 7 October 2026; recheck with `asset` |

`asset` selects public fields from the [Blockfrost asset lookup](https://docs.blockfrost.io).
It reports absent decimals as null/UNVERIFIED, never an assumed six. Token registry
metadata is distinct from validator-enforced quantities. Do not fabricate metadata
if unavailable. tADA/tUSDM are test tokens with no redemption value; see the
[Masumi token guide](https://www.masumi.network/dev/masumi/core-concepts/tokens).

## 4. Register the filler test agent

After the selling wallet is funded, use the admin registry form for **Preprod**.
`registration.example.json` captures the V2 request shape found in the pinned
[registry schema](https://github.com/masumi-network/masumi-payment-service/blob/71455701ac22c3380c50da54089e1b7363f6825d/src/routes/api/registry/schemas.ts).
Replace its selling verification key with the `Selling` wallet's public
`walletVkey`, and its URL with the founder's actual test-service URL. Do not register
the placeholder or advertise an endpoint as working before it exists. The
human-assisted procurement capability and test labels must remain explicit.

V2 uses `supportedPaymentSources` with Cardano/Preprod/Web3CardanoV2 and Dynamic
pricing; it does not accept the legacy top-level `AgentPricing`. Confirm the node's
native payment-source script address matches the template before submission.
Registry submission is an on-chain test transaction, signed by the selling wallet.
Record its agent identifier, transaction hash and observed confirmation separately;
a POST response or pending registration is not proof of confirmed registration.
If no real test-service URL is ready, record registration as pending.

## 5. Actor tokens and the app boundary

Create two separate API keys in the local admin UI, with Preprod-only network
limits, no EVM chain access, wallet scope enabled, and the appropriate public hot
wallet ID: purchasing for buyer, selling for filler. Enable read/pay, disable admin,
and assign explicit test spending credits. Upstream defaults can be broader than
this, so inspect the saved restrictions. A2 must demonstrate that each key can use
its own wallet and cannot use the other wallet. Do not claim actor isolation from
configuration alone.

Put values only in the app's ignored root `.env`, using the existing shared names:
`BUYER_MASUMI_URL`, `BUYER_MASUMI_TOKEN`, `FILLER_MASUMI_URL`, `FILLER_MASUMI_TOKEN`.
Both URLs will point to this node; their exact base path is an A2 adapter decision.
Do not use the admin key as an actor token. Creating those settings does not enable
the still-unimplemented app settlement adapter.

## Operation and failure handling

```sh
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml ps -a
docker compose --env-file infra/masumi/.env -f infra/masumi/compose.yaml stop
```

Stop preserves the named database volume. Avoid `down -v`: it deletes persisted
state. This database is separate from the procurement app's database. Wallet
phrases remain in the ignored file after containers stop.

Raw upstream node/migration/seed output can contain sensitive data. The node uses
Docker's `none` logging driver; the migration/seed wrapper captures upstream output
and prints only success, exit status, and Prisma error codes. Do not dump Compose
configuration, container environment, wallet secrets, database contents or raw
seed output into chat or a commit. Missing provider/phrase guards stop before the
seed runs. `P1001` typically indicates a database connection issue; verify Postgres
health and the unchanged local password. A failure without a public diagnostic
must be investigated locally with redaction rather than enabling raw persistent logs.

## Completion evidence

A1 is complete only when a fresh teammate follows this runbook and sees funded
wallets, the actual asset/decimals are recorded, and the filler registration has
confirmed. Record all observations in `docs/integration-manifest.md` with UTC time.
A2 then measures lock/result/collection/refund/deadline paths, fees and signers.
No A1 source value replaces that live gate.
