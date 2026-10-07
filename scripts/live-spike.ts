// Live Preprod escrow spike (A2): proves the Masumi lifecycle through the app's own commands and worker jobs.
// Order 1: claim → escrow terms → buyer lock → (no merchant email: buyer approves manually) → result → payout.
// Order 2: claim → escrow terms → buyer lock → no result → automatic refund.
// Merchant layer is the fixture (MOCK); payment layer is LIVE. Writes a JSON trace to .local/spike-<time>.json.
// Usage: npm run spike   (needs the node running, funded wallets and `npm run masumi:setup` done)
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { runOne } from '../apps/worker/worker.js';
import { settlementJobs } from '../apps/worker/jobs/settlement.js';
import { verifyEvidence } from '../apps/worker/jobs/verify_evidence.js';
import type { Actor, Order } from '../packages/contracts/index.js';
import { putRecipient, storeEvidence } from '../packages/procurement/evidence.js';
import { Procurement } from '../packages/procurement/service.js';
import { Store } from '../packages/procurement/store.js';
import { MasumiNative } from '../packages/settlement/masumi-native.js';

const url = process.env.DATABASE_URL, agent = process.env.FILLER_AGENT_IDENTIFIER, asset = process.env.ESCROW_ASSET_ID;
if (!url || !agent || !asset) throw new Error('Need DATABASE_URL, FILLER_AGENT_IDENTIFIER and ESCROW_ASSET_ID (run npm run masumi:setup).');
process.env.ESCROW_RESULT_WINDOW_MIN ??= '20';
const buyer: Actor = { id: 'spike-buyer', role: 'BUYER' }, filler: Actor = { id: 'spike-filler', role: 'FILLER' };
process.env.FUNDING_BUYER_ID = buyer.id;
const admin = new pg.Pool({ connectionString: url });
await admin.query('CREATE SCHEMA IF NOT EXISTS spike');
await admin.end();
const store = new Store(url, 'spike');
await store.migrate();
const service = new Procurement(store);
const handlers = { ...settlementJobs({ adapter: MasumiNative.fromEnv(), agentIdentifier: agent, pollMs: 20_000 }), verify_evidence: verifyEvidence };
const act = async (actor: Actor, command: object, op: string) => service.act(actor, (await service.prepare(actor, command)).id, op);
const load = async (id: string) => (await store.pool.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1', [id])).rows[0]!.data;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const log: { at: string; order: string; event: string; detail?: unknown }[] = [];
const note = (order: string, event: string, detail?: unknown) => {
  log.push({ at: new Date().toISOString(), order, event, ...(detail === undefined ? {} : { detail }) });
  console.log(`${new Date().toLocaleTimeString()}  [${order}] ${event}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};

async function order(tag: string) {
  await putRecipient(store, buyer, `spike-${stamp}-${tag}`, { name: 'Spike Recipient', line1: 'Test line', city: 'Test City', state: 'Test State',
    postalCode: '000000', country: 'IN' });
  const id = (await act(buyer, { command: 'create_intent', input: { clientOrderId: `spike-${stamp}-${tag}`, merchantId: 'fixture-merchant',
    sku: 'spike-item', itemTitle: 'Spike test item', quantity: 1, recipientRef: `spike-${stamp}-${tag}`, currency: 'INR', fiatMinor: '100',
    netTokenUnits: process.env.SPIKE_UNITS ?? '1000000', assetId: asset, network: 'cardano:preprod' } }, `create-${stamp}-${tag}`)).orderId;
  await act(filler, { command: 'claim', orderId: id }, `claim-${stamp}-${tag}`);
  note(tag, 'claimed', { orderId: id });
  return id;
}
const ids = { payout: await order('payout'), refund: await order('refund') };
const done = new Set<string>(), seen = new Map<string, string>();
const deadline = Date.now() + 90 * 60_000;
while (done.size < 2 && Date.now() < deadline) {
  while (await runOne(store, handlers)) { /* drain due jobs */ }
  for (const [tag, id] of Object.entries(ids)) {
    if (done.has(tag)) continue;
    const o = await load(id);
    const state = `${o.funding}/${o.escrow?.nativeState ?? '-'}/${o.settlement?.state ?? '-'}/${o.verification?.verdict ?? '-'}`;
    if (seen.get(tag) !== state) { note(tag, state, { txs: o.escrow?.txs ?? [], deadlines: o.escrow?.deadlines }); seen.set(tag, state); }
    if (o.escrow?.terms && o.funding === 'NOT_OBSERVED') await act(buyer, { command: 'fund_escrow', orderId: id }, `fund-${stamp}-${tag}`);
    if (tag === 'payout' && o.funding === 'CONFIRMED' && !o.purchase) {
      await act(filler, { command: 'register_purchase', orderId: id, purchaseOperationId: `p-${stamp}` }, `reg-${stamp}`);
      await service.observePurchase(filler, id, { purchaseOperationId: `p-${stamp}`, state: 'ORDERED', merchantOrderId: `SPIKE-${stamp}` });
      const { evidenceId } = await storeEvidence(store, filler, id, Buffer.from(`Subject: spike ${stamp}\r\nDate: ${new Date().toUTCString()}\r\n\r\nno merchant email in the spike\r\n`));
      await act(filler, { command: 'submit_evidence', orderId: id, purchaseOperationId: `p-${stamp}`, merchantOrderId: `SPIKE-${stamp}`, evidenceId }, `ev-${stamp}`);
      note(tag, 'evidence submitted (fixture merchant → INCONCLUSIVE expected)');
    }
    if (tag === 'payout' && o.verification && o.verification.verdict !== 'PASS' && o.verification.execution !== 'MANUAL') {
      await act(buyer, { command: 'review_evidence', orderId: id, decision: 'APPROVE' }, `review-${stamp}`);
      note(tag, 'buyer approved manually (labelled MANUAL)');
    }
    if (['PAID', 'REFUNDED'].includes(o.settlement?.state ?? '')) { done.add(tag); note(tag, `FINAL ${o.settlement!.state}`, { txs: o.escrow?.txs }); }
  }
  await new Promise(resolve => setTimeout(resolve, 15_000));
}
await mkdir('.local', { recursive: true });
await writeFile(`.local/spike-${stamp}.json`, JSON.stringify({ network: 'cardano:preprod', agent, asset, ids, log }, null, 2));
console.log(done.size === 2 ? `\nSPIKE PASSED — trace .local/spike-${stamp}.json` : `\nSPIKE INCOMPLETE (${[...done].join(',') || 'none'} done) — trace .local/spike-${stamp}.json`);
await store.close();
