import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/procurement/store.js';
import { Procurement } from '../packages/procurement/service.js';
import { ActorRuntime } from '../packages/agent-runtime/index.js';
import { confirmFixtureFunding, ScriptedCheckout } from '../fixtures/adapters.js';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../packages/contracts/index.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const store = new Store(process.env.DATABASE_URL);
const service = new Procurement(store);
const directory = await mkdtemp(join(tmpdir(), 'gob-demo-'));
const buyer: Actor = { id: 'demo-buyer', role: 'BUYER' };
const filler: Actor = { id: 'demo-filler', role: 'FILLER' };
try {
  await store.migrate();
  const intent = await service.prepare(buyer, { command: 'create_intent', input: {
    clientOrderId: randomUUID(), merchantId: 'fixture-merchant', sku: 'coke-330ml', quantity: 1,
    recipientRef: 'synthetic-recipient', currency: 'USD', fiatMinor: '500', netTokenUnits: '5100000',
    assetId: 'fixture:test-token', network: 'cardano:preprod',
  } });
  const { orderId } = await service.act(buyer, intent.id, randomUUID());
  const claim = await service.prepare(filler, { command: 'claim', orderId });
  await service.act(filler, claim.id, randomUUID());
  const view = await service.inspect(filler, orderId);
  await confirmFixtureFunding(store, orderId, view.claimId!);
  const checkout = new ScriptedCheckout(true);
  const runtime = new ActorRuntime(directory, service, checkout);
  await runtime.startRun({ runId: 'demo-run', actor: filler, orderId, termsHash: view.termsHash, checkoutAuthorized: true });
  const unknown = await runtime.purchase('demo-run');
  await runtime.stop('demo-run');
  const freshRuntime = new ActorRuntime(directory, new Procurement(store), checkout);
  const recovered = await freshRuntime.reconcile('demo-run');
  console.log(JSON.stringify({ scope: 'MOCK_CONTROL_CONTRACT', orderId,
    interruptedState: unknown.run.purchase?.state, recoveredState: recovered.run.purchase?.state,
    checkoutCalls: checkout.calls, stopped: recovered.run.stopped,
    decisionViewBytes: Buffer.byteLength(JSON.stringify(recovered.control)),
    verification: recovered.control.outcome.verification, settlement: recovered.control.outcome.settlement }, null, 2));
} finally {
  await store.close();
  // Demo records remain in the local database; no unresolved real funds exist.
  await rm(directory, { recursive: true, force: true });
}
