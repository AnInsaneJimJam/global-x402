import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOne } from '../apps/worker/worker.js';
import { settlementJobs } from '../apps/worker/jobs/settlement.js';
import { verifyEvidenceJob } from '../apps/worker/jobs/verify_evidence.js';
import { assignment, putRecipient, storeEvidence } from '../packages/procurement/evidence.js';
import { ScriptedSettlement } from '../fixtures/settlement.js';
import { fixtureMerchant, orderEmail, sign, testKey } from '../fixtures/synthetic/merchant.js';
import { buyer, claim, context, filler, intent } from './helpers.js';

const key = testKey();
const recipient = { name: 'Alice Doe', line1: '1 Synthetic Street', city: 'Demo City', state: 'Demo State', postalCode: '000000', country: 'SG' };

async function setup() {
  const c = await context();
  const dir = await mkdtemp(join(tmpdir(), 'gob-settle-'));
  const chain = new ScriptedSettlement();
  // The fixture email is dated 10:00Z; give the escrow a window around it.
  const now = () => new Date('2026-10-07T09:00:00Z');
  const handlers = { ...settlementJobs({ adapter: chain, agentIdentifier: 'a'.repeat(64), now, pollMs: 0 }),
    verify_evidence: verifyEvidenceJob({ merchants: { 'fixture-merchant': fixtureMerchant }, resolveDkimKey: async () => key.record,
      evidenceDir: dir, now: () => new Date('2026-10-07T10:05:00Z') }) };
  // Bounded drain: observe_escrow reschedules itself until a terminal state.
  const drain = async (max = 20) => { for (let n = 0; n < max && await runOne(c.store, handlers); n++) { /* next */ } };
  const order = async (clientOrderId: string) => {
    const plan = await c.service.prepare(buyer, { command: 'create_intent', input: { ...intent, clientOrderId,
      itemTitle: 'Coca-Cola Original 330ml', currency: 'INR', fiatMinor: '5000', recipientRef: `r-${clientOrderId}` } });
    const orderId = (await c.service.act(buyer, plan.id, `create-${clientOrderId}`)).orderId;
    await putRecipient(c.store, buyer, `r-${clientOrderId}`, recipient);
    await claim(c.service, orderId);
    await drain();
    return orderId;
  };
  const act = async (actor: typeof buyer, command: object, op: string) =>
    c.service.act(actor, (await c.service.prepare(actor, command)).id, op);
  return { c, dir, chain, drain, order, act, close: async () => { await rm(dir, { recursive: true, force: true }); await c.close(); } };
}

test('escrow lifecycle: terms at claim, buyer funds, PASS submits result, payout observed', async () => {
  const s = await setup();
  try {
    const orderId = await s.order('happy');
    let view = await s.c.service.inspect(buyer, orderId);
    assert.equal(view.actions.find(a => a.command === 'fund_escrow')?.status, 'AVAILABLE');
    assert.equal(view.obligations.find(o => o.type === 'FUND_ESCROW')?.owner, buyer.id);
    await s.act(buyer, { command: 'fund_escrow', orderId }, 'fund');
    await s.drain();
    view = await s.c.service.inspect(filler, orderId);
    assert.equal(view.facts.find(f => f.key === 'funding')?.value, 'CONFIRMED');
    // Filler buys and proves placement.
    await s.act(filler, { command: 'register_purchase', orderId, purchaseOperationId: 'p1' }, 'reg');
    await s.c.service.observePurchase(filler, orderId, { purchaseOperationId: 'p1', state: 'ORDERED', merchantOrderId: '403-1234567-7654321' });
    const nonce = (await assignment(s.c.store, filler, orderId)).nonce!;
    const { evidenceId } = await storeEvidence(s.c.store, filler, orderId, await sign(orderEmail({ nonce }), key.privateKey), s.dir);
    await s.act(filler, { command: 'submit_evidence', orderId, purchaseOperationId: 'p1', merchantOrderId: '403-1234567-7654321', evidenceId }, 'ev');
    await s.drain();
    view = await s.c.service.inspect(buyer, orderId);
    assert.equal(view.outcome.verification, 'PASS', JSON.stringify(view.facts));
    assert.equal(view.outcome.settlement, 'DISPUTE_WINDOW');
    assert.deepEqual(s.chain.calls, ['createEscrowTerms', 'fund', 'submitResult']);
    // Masumi pays the filler automatically after unlock; the observer records it.
    s.chain.set([...s.chain.escrows.keys()][0]!, 'Withdrawn');
    await s.drain();
    view = await s.c.service.inspect(filler, orderId);
    assert.equal(view.outcome.settlement, 'PAID');
    assert.equal(view.exposure[0]?.kind, 'FIXTURE_LOCKED');
  } finally { await s.close(); }
});

test('refund path: buyer requests, filler authorizes, refund observed', async () => {
  const s = await setup();
  try {
    const orderId = await s.order('refund');
    await s.act(buyer, { command: 'fund_escrow', orderId }, 'fund');
    await s.drain();
    await s.act(buyer, { command: 'request_refund', orderId }, 'refund');
    await s.drain();
    let view = await s.c.service.inspect(filler, orderId);
    assert.equal(view.outcome.settlement, 'REFUND_PENDING');
    assert.equal(view.actions.find(a => a.command === 'authorize_refund')?.status, 'AVAILABLE');
    await s.act(filler, { command: 'authorize_refund', orderId }, 'authorize');
    await s.drain();
    s.chain.set([...s.chain.escrows.keys()][0]!, 'RefundWithdrawn');
    await s.drain();
    view = await s.c.service.inspect(buyer, orderId);
    assert.equal(view.outcome.settlement, 'REFUNDED');
    assert.deepEqual(s.chain.calls, ['createEscrowTerms', 'fund', 'requestRefund', 'authorizeRefund']);
  } finally { await s.close(); }
});
