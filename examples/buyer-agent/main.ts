// Buyer reference agent CLI.
// Usage: npm run buyer -- [path/to/purchase.json]   (default examples/buyer-agent/purchase.example.json)
// Env: GOB_API (default http://127.0.0.1:3000), GOB_BUYER_TOKEN, ESCROW_ASSET_ID, optional BUYER_MAX_ESCROW_BASE_UNITS.
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { ControlClient } from '../../packages/contracts/client.js';
import { runBuyerAgent } from './agent.js';
import type { Purchase } from './agent.js';

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Set ${name} (see examples/buyer-agent/main.ts header).`);
  return value;
};
const file = process.argv[2] ?? new URL('./purchase.example.json', import.meta.url).pathname;
const spec = JSON.parse(await readFile(file, 'utf8')) as Omit<Purchase, 'assetId'>;
const io = createInterface({ input: process.stdin, output: process.stdout });
try {
  await runBuyerAgent({
    client: new ControlClient(env('GOB_API', 'http://127.0.0.1:3000'), env('GOB_BUYER_TOKEN')),
    purchase: { ...spec, assetId: env('ESCROW_ASSET_ID') },
    policy: { allowedMerchants: ['amazon-in', 'amazon-sg'], maxEscrowBaseUnits: env('BUYER_MAX_ESCROW_BASE_UNITS', '50000000'),
      minResultWindowMinutes: 20 },
    say: line => console.log(line), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    review: async view => {
      const v = view.facts.find(f => f.key === 'verification')?.value as { criteria?: { id: string; result: string; expected: string; observed: string | null }[] };
      console.log('\nEvidence did not pass automatically:');
      for (const c of v?.criteria ?? []) if (c.result !== 'PASS') console.log(`  ${c.id}: expected ${c.expected}, saw ${c.observed ?? '—'} (${c.result})`);
      const answer = (await io.question('Approve anyway (a) or reject and request refund (r)? ')).trim().toLowerCase();
      return answer.startsWith('a') ? 'APPROVE' : 'REJECT';
    },
  });
} finally { io.close(); }
