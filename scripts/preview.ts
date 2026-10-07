// UI preview with MOCK settlement (labels say MOCK). Seeds a separate "preview" schema and serves the dashboard on
// :3100 with tokens "preview-buyer" / "preview-filler". Usage: npm run preview
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createApp } from '../apps/api/app.js';
import { runOne } from '../apps/worker/worker.js';
import { settlementJobs } from '../apps/worker/jobs/settlement.js';
import { verifyEvidenceJob } from '../apps/worker/jobs/verify_evidence.js';
import type { Actor } from '../packages/contracts/index.js';
import { assignment, putRecipient, storeEvidence } from '../packages/procurement/evidence.js';
import { Procurement } from '../packages/procurement/service.js';
import { Store } from '../packages/procurement/store.js';
import { ScriptedSettlement } from '../fixtures/settlement.js';
import { fixtureMerchant, orderEmail, sign, testKey } from '../fixtures/synthetic/merchant.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Pool({ connectionString: url });
await admin.query('DROP SCHEMA IF EXISTS preview CASCADE; CREATE SCHEMA preview');
await admin.end();
const store = new Store(url, 'preview');
await store.migrate();
process.env.EVIDENCE_DIR = await mkdtemp(join(tmpdir(), 'gob-preview-'));
const service = new Procurement(store);
const buyer: Actor = { id: 'dev-buyer', role: 'BUYER' }, filler: Actor = { id: 'dev-filler', role: 'FILLER' };
const key = testKey(), chain = new ScriptedSettlement();
const handlers = { ...settlementJobs({ adapter: chain, agentIdentifier: 'a'.repeat(64), pollMs: 0 }),
  verify_evidence: verifyEvidenceJob({ merchants: { 'fixture-merchant': fixtureMerchant }, resolveDkimKey: async () => key.record }) };
const drain = async () => { for (let n = 0; n < 30 && await runOne(store, handlers); n++) { /* next */ } };
const act = async (actor: Actor, command: object, op: string) => service.act(actor, (await service.prepare(actor, command)).id, op);
const recipient = { name: 'Alice Doe', line1: '1 Synthetic Street', city: 'Demo City', state: 'Demo State', postalCode: '000000', country: 'SG' };

async function order(n: number, title: string, fiatMinor: string, units: string) {
  await putRecipient(store, buyer, `home-${n}`, recipient);
  return (await act(buyer, { command: 'create_intent', input: { clientOrderId: `preview-${n}`, merchantId: 'fixture-merchant',
    sku: `sku-${n}`, itemTitle: title, quantity: 1, recipientRef: `home-${n}`, currency: 'INR', fiatMinor, netTokenUnits: units,
    assetId: 'fixture:test-token', network: 'cardano:preprod' } }, `create-${n}`)).orderId;
}
// 1: fully verified, in dispute window. 2: funded, waiting for the filler's order. 3: open for claiming.
const done = await order(1, 'Coca-Cola Original 330ml', '5000', '600000');
const funded = await order(2, 'Parle-G Biscuits 250g', '3000', '360000');
await order(3, 'Maggi 2-Minute Noodles 70g', '1400', '170000');
for (const [id, op] of [[done, 'a'], [funded, 'b']] as const) {
  await act(filler, { command: 'claim', orderId: id }, `claim-${op}`); await drain();
  await act(buyer, { command: 'fund_escrow', orderId: id }, `fund-${op}`); await drain();
}
await act(filler, { command: 'register_purchase', orderId: done, purchaseOperationId: 'p-a' }, 'reg-a');
await service.observePurchase(filler, done, { purchaseOperationId: 'p-a', state: 'ORDERED', merchantOrderId: '403-1234567-7654321' });
const nonce = (await assignment(store, filler, done)).nonce!;
const { evidenceId } = await storeEvidence(store, filler, done,
  await sign(orderEmail({ nonce, date: new Date(Date.now() + 1000).toUTCString() }), key.privateKey));
await act(filler, { command: 'submit_evidence', orderId: done, purchaseOperationId: 'p-a', merchantOrderId: '403-1234567-7654321', evidenceId }, 'ev-a');
await drain();
const app = createApp(service, new Map([['preview-buyer', buyer], ['preview-filler', filler]]));
await app.listen({ host: '127.0.0.1', port: 3100 });
console.log('Preview (MOCK settlement) at http://127.0.0.1:3100 — tokens: preview-buyer / preview-filler');
