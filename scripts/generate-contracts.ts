import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { commandSchema, commandDescriptions, controlSchema, planSchema, receiptSchema } from '../packages/contracts/index.js';
const guide = `# Local control-contract quickstart\n\nGenerated from runtime command definitions. Payment is MOCK until a live Masumi adapter exists. Merchant/verifier labels are per order: amazon-in orders are LIVE, HUMAN_ASSISTED checkout, APP_WORKER_DKIM verification (MANUAL after buyer review); fixture orders are MOCK.\nLive funding, wallet authentication, native refunds and settlement are unavailable. A live DKIM PASS on a fresh merchant email is not yet demonstrated.\n\nInspect GET /v1/capabilities, then GET /v1/orders for redacted opportunities or authenticated GET /v1/work for owned orders.\nPrepare a typed command with POST /v1/action-plans. Commit the returned planId with a stable operationId and Idempotency-Key through its named route.\n\n${Object.entries(commandDescriptions).map(([command, description]) => `- ${command}: ${description.role}; POST ${description.path}. ${description.meaning}`).join('\n')}\n\nInspect GET /v1/orders/:id/control before choosing the next action. After timeout, retrieve GET /v1/operations/:operationId and reconcile the same operation; do not mint a replacement ID.\nAn actor-local unknown or already ordered purchase blocks another checkout. Stopping the local run keeps reconciliation available.\n\nThe reference filler agent (npm run filler) ranks, claims, waits for funding, hands checkout to the human, uploads the .eml and waits for the verdict; the buyer agent is not built yet.\nRaw merchant credentials and keys never enter this API. Dev bearer authentication is for localhost testing only.\n`;
const artifacts = {
  'commands.schema.json': JSON.stringify(z.toJSONSchema(commandSchema), null, 2) + '\n',
  'plans.schema.json': JSON.stringify(z.toJSONSchema(planSchema), null, 2) + '\n',
  'receipts.schema.json': JSON.stringify(z.toJSONSchema(receiptSchema), null, 2) + '\n',
  'control.schema.json': JSON.stringify(z.toJSONSchema(controlSchema), null, 2) + '\n',
  'agent-quickstart.md': guide,
};
await mkdir(new URL('../docs/generated/', import.meta.url), { recursive: true });
for (const [name, content] of Object.entries(artifacts)) {
  const path = new URL(`../docs/generated/${name}`, import.meta.url);
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== content) throw new Error(`Generated artifact drift: ${name}`);
  } else await writeFile(path, content);
}
console.log(process.argv.includes('--check') ? 'Generated contracts and guide match runtime definitions.' : 'Generated contracts and guide.');
