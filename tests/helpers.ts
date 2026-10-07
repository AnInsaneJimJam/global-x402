import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { Store } from '../packages/procurement/store.js';
import { Procurement } from '../packages/procurement/service.js';
import type { Actor } from '../packages/contracts/index.js';

export const buyer: Actor = { id: 'buyer', role: 'BUYER' };
export const filler: Actor = { id: 'filler', role: 'FILLER' };
export const otherFiller: Actor = { id: 'other-filler', role: 'FILLER' };
export const intent = {
  clientOrderId: 'intent-1', merchantId: 'fixture-merchant', sku: 'coke-330ml', quantity: 1,
  recipientRef: 'synthetic-recipient', currency: 'USD', fiatMinor: '500', netTokenUnits: '5100000',
  assetId: 'fixture:test-token', network: 'cardano:preprod',
} as const;

export async function context() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL required; tests use isolated temporary schemas in PostgreSQL.');
  const admin = new pg.Pool({ connectionString: url });
  const schema = `gob_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const store = new Store(url, schema);
  await store.migrate();
  let now = new Date('2026-10-07T00:00:00Z');
  const service = new Procurement(store, () => now);
  return { store, service, advance: (ms: number) => { now = new Date(now.getTime() + ms); },
    close: async () => { await store.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}
export async function createOrder(service: Procurement, clientOrderId = 'intent-1') {
  const plan = await service.prepare(buyer, { command: 'create_intent', input: { ...intent, clientOrderId } });
  return (await service.act(buyer, plan.id, `create-${clientOrderId}`)).orderId;
}
export async function claim(service: Procurement, orderId: string) {
  const plan = await service.prepare(filler, { command: 'claim', orderId });
  await service.act(filler, plan.id, `claim-${orderId}`);
  return (await service.inspect(filler, orderId)).claimId!;
}
