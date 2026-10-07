import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { commandSchema, commandDescriptions, controlSchema, planSchema, receiptSchema } from '../packages/contracts/index.js';
const guide = `# Local control-contract quickstart\n\nGenerated from runtime command definitions. All payment/merchant/verifier layers are MOCK.\nLive funding, wallet authentication, independent verification, native refunds and settlement are unavailable.\n\nInspect GET /v1/capabilities, then GET /v1/orders for redacted opportunities or authenticated GET /v1/work for owned orders.\nPrepare a typed command with POST /v1/action-plans. Commit the returned planId with a stable operationId and Idempotency-Key through its named route.\n\n${Object.entries(commandDescriptions).map(([command, description]) => `- ${command}: ${description.role}; POST ${description.path}. ${description.meaning}`).join('\n')}\n\nInspect GET /v1/orders/:id/control before choosing the next action. After timeout, retrieve GET /v1/operations/:operationId and reconcile the same operation; do not mint a replacement ID.\nAn actor-local unknown or already ordered purchase blocks another checkout. Stopping the local run keeps reconciliation available.\n\nThe local reference runtime supports startRun, inspect, purchase, reconcile, stop and resume. It requires an existing claimed/funded fixture; it is not yet a complete autonomous buyer/filler agent.\nRaw merchant credentials and keys never enter this API. Dev bearer authentication is for localhost testing only.\n`;
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
