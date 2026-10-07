import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from '../packages/contracts/index.js';
import { Procurement } from '../packages/procurement/service.js';
import { storeEvidence } from '../packages/procurement/evidence.js';
import { ActorRuntime } from '../packages/agent-runtime/index.js';
import { confirmFixtureFunding, ScriptedCheckout } from '../fixtures/adapters.js';
import { context, createOrder, claim, buyer, filler, otherFiller } from './helpers.js';

function code(expected: string) {
  return (error: unknown) => error instanceof DomainError && error.code === expected;
}
test('competing filler commits produce exactly one assignment', async () => {
  const c = await context();
  try {
    const orderId = await createOrder(c.service);
    const plans = await Promise.all([filler, otherFiller].map(actor => c.service.prepare(actor, { command: 'claim', orderId })));
    const results = await Promise.allSettled(plans.map((plan, i) => c.service.act(plan.actor, plan.id, `claim-${i}`)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = results.find(r => r.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && code('STALE_PLAN')(rejected.reason));
    const snapshot = await c.service.inspect(buyer, orderId);
    assert.ok(snapshot.claimId);
  } finally { await c.close(); }
});

test('preparation is side-effect free; unfunded assignment blocks checkout', async () => {
  const c = await context();
  try {
    const orderId = await createOrder(c.service);
    await c.service.prepare(filler, { command: 'claim', orderId });
    assert.equal((await c.service.inspect(buyer, orderId)).claimId, null);
    await claim(c.service, orderId);
    await assert.rejects(c.service.prepare(filler, { command: 'register_purchase', orderId, purchaseOperationId: 'purchase' }), code('FUNDING_NOT_CONFIRMED'));
    await assert.rejects(confirmFixtureFunding(c.store, orderId, 'wrong-claim'), code('FIXTURE_FUNDING_BINDING_MISMATCH'));
  } finally { await c.close(); }
});

test('expired plan blocks new effect, but admitted operation survives restart and expiry', async () => {
  const c = await context();
  try {
    const orderId = await createOrder(c.service);
    const plan = await c.service.prepare(filler, { command: 'claim', orderId });
    const results = await Promise.all([c.service.act(filler, plan.id, 'stable-op'), c.service.act(filler, plan.id, 'stable-op')]);
    assert.deepEqual(results[0], results[1]);
    c.advance(61_000);
    const restarted = new Procurement(c.store, c.service.clock);
    assert.deepEqual(await restarted.act(filler, plan.id, 'stable-op'), results[0]);
    await assert.rejects(restarted.act(filler, plan.id, 'new-op'), code('PLAN_EXPIRED'));
    const newOrder = await createOrder(restarted, 'intent-2');
    const changed = await restarted.prepare(filler, { command: 'claim', orderId: newOrder });
    await assert.rejects(restarted.act(filler, changed.id, 'stable-op'), code('OPERATION_CONFLICT'));
  } finally { await c.close(); }
});

test('private IDs and wrong role cannot authorize a plan or purchase', async () => {
  const c = await context();
  try {
    const orderId = await createOrder(c.service);
    const plan = await c.service.prepare(filler, { command: 'claim', orderId });
    await assert.rejects(c.service.act(otherFiller, plan.id, 'stolen'), code('NOT_FOUND'));
    await claim(c.service, orderId);
    await assert.rejects(c.service.inspect(otherFiller, orderId), code('NOT_FOUND'));
    await assert.rejects(c.service.prepare(buyer, { command: 'register_purchase', orderId, purchaseOperationId: 'purchase' }), code('NOT_FOUND'));
  } finally { await c.close(); }
});

test('two purchase registrations cannot race through confirmed funding', async () => {
  const c = await context();
  try {
    const orderId = await createOrder(c.service);
    await confirmFixtureFunding(c.store, orderId, await claim(c.service, orderId));
    const plans = await Promise.all(['p1', 'p2'].map(purchaseOperationId => c.service.prepare(filler, { command: 'register_purchase', orderId, purchaseOperationId })));
    const results = await Promise.allSettled(plans.map((plan, i) => c.service.act(filler, plan.id, `register-${i}`)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await c.service.inspect(filler, orderId)).obligations[0]?.type, 'RECONCILE_PURCHASE');
  } finally { await c.close(); }
});

test('lost checkout response, stop, restart and reconciliation never buy twice', async () => {
  const c = await context(); const directory = await mkdtemp(join(tmpdir(), 'gob-actor-'));
  try {
    const orderId = await createOrder(c.service);
    await confirmFixtureFunding(c.store, orderId, await claim(c.service, orderId));
    const checkout = new ScriptedCheckout(true);
    const runtime = new ActorRuntime(directory, c.service, checkout);
    const input = { runId: 'run-1', actor: filler, orderId, termsHash: (await c.service.inspect(filler, orderId)).termsHash, checkoutAuthorized: true };
    await runtime.startRun(input); await runtime.startRun(input);
    const uncertain = await runtime.purchase('run-1');
    assert.equal(uncertain.run.purchase?.state, 'UNKNOWN');
    assert.equal(uncertain.control.actions[0]?.status, 'BLOCKED');
    await runtime.stop('run-1');
    const restarted = new ActorRuntime(directory, new Procurement(c.store), checkout);
    await assert.rejects(restarted.purchase('run-1'), code('RUN_STOPPED'));
    const recovered = await restarted.reconcile('run-1');
    assert.equal(recovered.run.purchase?.state, 'ORDERED');
    assert.equal(recovered.run.stopped, true);
    assert.equal(recovered.control.outcome.verification, 'NOT_STARTED');
    assert.equal(checkout.calls, 1);
    await restarted.resume('run-1');
    await assert.rejects(restarted.purchase('run-1'), code('PURCHASE_ALREADY_REGISTERED'));
    await assert.rejects(c.service.prepare(filler, { command: 'register_purchase', orderId, purchaseOperationId: 'second' }), code('PURCHASE_ALREADY_PLACED'));
    assert.equal(checkout.calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); await c.close(); }
});

test('missing or corrupt journal and missing grant block checkout', async () => {
  const c = await context(); const directory = await mkdtemp(join(tmpdir(), 'gob-actor-'));
  try {
    const orderId = await createOrder(c.service);
    await confirmFixtureFunding(c.store, orderId, await claim(c.service, orderId));
    const checkout = new ScriptedCheckout(); const runtime = new ActorRuntime(directory, c.service, checkout);
    await assert.rejects(runtime.purchase('absent'), code('LOCAL_JOURNAL_UNAVAILABLE'));
    await writeFile(join(directory, 'corrupt.json'), '{}');
    await assert.rejects(runtime.purchase('corrupt'), code('LOCAL_JOURNAL_UNAVAILABLE'));
    await runtime.startRun({ runId: 'denied', actor: filler, orderId, termsHash: (await c.service.inspect(filler, orderId)).termsHash, checkoutAuthorized: false });
    await assert.rejects(runtime.purchase('denied'), code('CHECKOUT_GRANT_REQUIRED'));
    assert.equal(checkout.calls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); await c.close(); }
});

test('actor-reported failure cannot authorize a replacement purchase', async () => {
  const c = await context();
  try {
    const orderId = await createOrder(c.service);
    await confirmFixtureFunding(c.store, orderId, await claim(c.service, orderId));
    const plan = await c.service.prepare(filler, { command: 'register_purchase', orderId, purchaseOperationId: 'p1' });
    await c.service.act(filler, plan.id, 'register');
    await c.service.observePurchase(filler, orderId, { purchaseOperationId: 'p1', state: 'UNKNOWN' });
    await assert.rejects(c.service.observePurchase(filler, orderId, { purchaseOperationId: 'p1', state: 'FAILED_CONFIRMED' }), code('INDEPENDENT_RECONCILIATION_REQUIRED'));
    await assert.rejects(c.service.prepare(filler, { command: 'register_purchase', orderId, purchaseOperationId: 'p2' }), code('UNRESOLVED_PURCHASE'));
  } finally { await c.close(); }
});

test('same merchant order cannot be submitted for two assignments', async () => {
  const c = await context();
  const dir = await mkdtemp(join(tmpdir(), 'gob-replay-'));
  try {
    for (const index of [1, 2]) {
      const orderId = await createOrder(c.service, `intent-${index}`);
      await confirmFixtureFunding(c.store, orderId, await claim(c.service, orderId));
      const plan = await c.service.prepare(filler, { command: 'register_purchase', orderId, purchaseOperationId: `p${index}` });
      await c.service.act(filler, plan.id, `register-${index}`);
      await c.service.observePurchase(filler, orderId, { purchaseOperationId: `p${index}`, state: 'ORDERED', merchantOrderId: 'same-merchant-order' });
      const { evidenceId } = await storeEvidence(c.store, filler, orderId, Buffer.from('Subject: same order\r\n\r\nbody'), dir);
      const evidence = await c.service.prepare(filler, { command: 'submit_evidence', orderId, purchaseOperationId: `p${index}`,
        merchantOrderId: 'same-merchant-order', evidenceId });
      if (index === 1) await c.service.act(filler, evidence.id, `evidence-${index}`);
      else await assert.rejects(c.service.act(filler, evidence.id, `evidence-${index}`), code('EVIDENCE_REPLAY'));
    }
  } finally { await rm(dir, { recursive: true, force: true }); await c.close(); }
});

test('transport key and named route cannot be reused for a different effect', async () => {
  const c = await context();
  try {
    const first = await createOrder(c.service, 'intent-1');
    const second = await createOrder(c.service, 'intent-2');
    const a = await c.service.prepare(filler, { command: 'claim', orderId: first });
    const b = await c.service.prepare(filler, { command: 'claim', orderId: second });
    await assert.rejects(c.service.act(filler, a.id, 'a', { command: 'submit_evidence', orderId: first }), code('PLAN_ROUTE_MISMATCH'));
    await c.service.act(filler, a.id, 'a', { command: 'claim', orderId: first }, 'fixed-key');
    await assert.rejects(c.service.act(filler, b.id, 'b', { command: 'claim', orderId: second }, 'fixed-key'), code('OPERATION_CONFLICT'));
    assert.equal((await c.service.inspect(buyer, second)).claimId, null);
  } finally { await c.close(); }
});

test('purchase operation cannot be rebound to another assignment', async () => {
  const c = await context();
  try {
    const orders = await Promise.all(['intent-1', 'intent-2'].map(clientId => createOrder(c.service, clientId)));
    for (const [index, orderId] of orders.entries()) {
      await confirmFixtureFunding(c.store, orderId, await claim(c.service, orderId));
      const plan = await c.service.prepare(filler, { command: 'register_purchase', orderId, purchaseOperationId: 'shared-purchase' });
      if (index === 0) await c.service.act(filler, plan.id, 'register-1');
      else await assert.rejects(c.service.act(filler, plan.id, 'register-2'), code('PURCHASE_OPERATION_CONFLICT'));
    }
  } finally { await c.close(); }
});

test('unfunded runtime admission leaves no misleading local purchase operation', async () => {
  const c = await context(); const directory = await mkdtemp(join(tmpdir(), 'gob-actor-'));
  try {
    const orderId = await createOrder(c.service); await claim(c.service, orderId);
    const checkout = new ScriptedCheckout(); const runtime = new ActorRuntime(directory, c.service, checkout);
    await runtime.startRun({ runId: 'unfunded', actor: filler, orderId, termsHash: (await c.service.inspect(filler, orderId)).termsHash, checkoutAuthorized: true });
    await assert.rejects(runtime.purchase('unfunded'), code('FUNDING_NOT_CONFIRMED'));
    assert.equal((await runtime.inspect('unfunded')).run.purchase, null);
    assert.equal(checkout.calls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); await c.close(); }
});
