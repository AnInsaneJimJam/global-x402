// Filler reference agent CLI (human-assisted checkout).
// Usage: npm run filler [-- <orderId to resume>]
// Env (all optional with the dev .env): GOB_API, GOB_FILLER_TOKEN (DEV_FILLER_TOKEN), GOB_FILLER_ID (dev-filler),
// FILLER_TARGET_UNITS (100 tUSDM), FILLER_MAX_FIAT_MINOR (1000.00), FILLER_CURRENCY (INR), FILLER_JOURNAL_DIR.
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { ControlClient } from '../../packages/contracts/client.js';
import { runFillerAgent } from './agent.js';

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Set ${name} (see examples/filler-agent/main.ts header).`);
  return value;
};
const io = createInterface({ input: process.stdin, output: process.stdout });
try {
  const view = await runFillerAgent({
    client: new ControlClient(env('GOB_API', 'http://127.0.0.1:3000'), env('GOB_FILLER_TOKEN', process.env.DEV_FILLER_TOKEN)),
    actor: { id: env('GOB_FILLER_ID', 'dev-filler'), role: 'FILLER' },
    journalDir: env('FILLER_JOURNAL_DIR', '.local/filler-journal'),
    policy: { assetId: env('ESCROW_ASSET_ID', 'fixture:test-token'), network: 'cardano:preprod', currency: env('FILLER_CURRENCY', 'INR'),
      targetUnits: env('FILLER_TARGET_UNITS', '100000000'), allowedOvershootUnits: '0', confirmedUnits: '0', reservedUnits: '0',
      remainingFiatMinor: env('FILLER_MAX_FIAT_MINOR', '100000'), latestClaimableAt: new Date(Date.now() + 7 * 864e5).toISOString() },
    settlementEstimateMs: 2 * 3600_000,
    ask: question => io.question(`\n${question}`), say: line => console.log(line),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), readFile: path => readFile(path),
    ...(process.argv[2] ? { orderId: process.argv[2] } : {}),
  });
  if (view) console.log(`\nOrder ${view.scope.id}: verification ${view.outcome.verification}, settlement ${view.outcome.settlement}.`);
} finally { io.close(); }
