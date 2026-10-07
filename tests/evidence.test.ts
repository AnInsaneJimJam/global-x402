import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from '../packages/contracts/index.js';
import { assignment, putRecipient, storeEvidence } from '../packages/procurement/evidence.js';
import { runOne } from '../apps/worker/worker.js';
import { verifyEvidenceJob } from '../apps/worker/jobs/verify_evidence.js';
import { confirmFixtureFunding } from '../fixtures/adapters.js';
import { fixtureMerchant, orderEmail, sign, testKey } from '../fixtures/synthetic/merchant.js';
import { buyer, claim, context, filler, intent, otherFiller } from './helpers.js';

const key = testKey();
const ORDER_NO = '403-1234567-7654321';
const recipient = { name: 'Alice Doe', line1: '1 Synthetic Street', city: 'Demo City', postalCode: '000000', country: 'SG' };
const code = (expected: string) => (error: unknown) => error instanceof DomainError && error.code === expected;
type Ctx = Awaited<ReturnType<typeof context>>;

async function fundedOrder(c: Ctx, clientOrderId: string, merchantOrderId = ORDER_NO) {
  const plan = await c.service.prepare(buyer, { command: 'create_intent', input: { ...intent, clientOrderId,
    itemTitle: 'Coca-Cola Original 330ml', currency: 'INR', fiatMinor: '5000', recipientRef: `r-${clientOrderId}` } });
  const orderId = (await c.service.act(buyer, plan.id, `create-${clientOrderId}`)).orderId;
  await putRecipient(c.store, buyer, `r-${clientOrderId}`, recipient);
  await confirmFixtureFunding(c.store, orderId, await claim(c.service, orderId));
  // Track A's observer will record these; set them directly until A4 lands.
  await c.store.pool.query('UPDATE gob_orders SET data = data || $2::jsonb WHERE id=$1', [orderId, JSON.stringify({
    fundedAt: '2026-10-07T09:00:00Z', escrow: { escrowId: 'e', sellerAgentId: 's', buyerWalletRef: 'b', assetId: intent.assetId,
      grossBaseUnits: '1', nativeState: 'FundsLocked', lastObservedAt: null, deadlines: { payBy: '2026-10-07T09:00:00Z',
        submitResultBy: '2026-10-07T12:00:00Z', unlockAt: '2026-10-07T13:00:00Z', externalDisputeUnlockAt: '2026-10-07T14:00:00Z' } } })]);
  const register = await c.service.prepare(filler, { command: 'register_purchase', orderId, purchaseOperationId: `p-${clientOrderId}` });
  await c.service.act(filler, register.id, `register-${clientOrderId}`);
  await c.service.observePurchase(filler, orderId, { purchaseOperationId: `p-${clientOrderId}`, state: 'ORDERED', merchantOrderId });
  return { orderId, nonce: (await assignment(c.store, filler, orderId)).nonce! };
}

async function submit(c: Ctx, dir: string, orderId: string, clientOrderId: string, raw: Buffer, merchantOrderId = ORDER_NO) {
  const { evidenceId } = await storeEvidence(c.store, filler, orderId, raw, dir);
  const plan = await c.service.prepare(filler, { command: 'submit_evidence', orderId,
    purchaseOperationId: `p-${clientOrderId}`, merchantOrderId, evidenceId });
  await c.service.act(filler, plan.id, `evidence-${clientOrderId}-${evidenceId.slice(0, 8)}`);
  // Drain due jobs. submit_result has no handler until Track A5, so it is retried later and stays queued.
  const handlers = { verify_evidence: verifyEvidenceJob({ merchants: { 'fixture-merchant': fixtureMerchant },
    resolveDkimKey: async () => key.record, evidenceDir: dir, now: () => new Date('2026-10-07T10:05:00Z') }) };
  while (await runOne(c.store, handlers)) { /* next job */ }
  return c.service.inspect(buyer, orderId);
}
const resultJobs = async (c: Ctx, orderId: string) =>
  (await c.store.pool.query("SELECT id FROM gob_outbox WHERE kind='submit_result' AND order_id=$1", [orderId])).rowCount;

async function withContext(fn: (c: Ctx, dir: string) => Promise<void>) {
  const c = await context();
  const dir = await mkdtemp(join(tmpdir(), 'gob-evidence-'));
  try { await fn(c, dir); } finally { await rm(dir, { recursive: true, force: true }); await c.close(); }
}

test('claim issues a nonce; recipient is immutable and revealed only to the funded assigned filler', () => withContext(async c => {
  const plan = await c.service.prepare(buyer, { command: 'create_intent', input: { ...intent, recipientRef: 'r-1' } });
  const orderId = (await c.service.act(buyer, plan.id, 'create')).orderId;
  await putRecipient(c.store, buyer, 'r-1', recipient);
  await assert.rejects(putRecipient(c.store, buyer, 'r-1', { ...recipient, line1: 'Elsewhere' }), code('RECIPIENT_IMMUTABLE'));
  const claimId = await claim(c.service, orderId);
  await assert.rejects(assignment(c.store, filler, orderId), code('FUNDING_NOT_CONFIRMED'));
  await assert.rejects(assignment(c.store, otherFiller, orderId), code('NOT_FOUND'));
  await confirmFixtureFunding(c.store, orderId, claimId);
  const view = await assignment(c.store, filler, orderId);
  assert.match(view.nonce!, /^GOB-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(view.recipient.name, `Alice Doe ${view.nonce}`);
}));

test('valid signed confirmation passes DKIM verification and queues submit_result', () => withContext(async (c, dir) => {
  const { orderId, nonce } = await fundedOrder(c, 'ok');
  const control = await submit(c, dir, orderId, 'ok', await sign(orderEmail({ nonce }), key.privateKey));
  assert.equal(control.outcome.verification, 'PASS', JSON.stringify(control.facts));
  assert.equal(await resultJobs(c, orderId), 1);
}));

test('failed evidence goes to buyer review: approve queues submit_result, reject does not', () => withContext(async (c, dir) => {
  for (const [clientOrderId, decision] of [['approve', 'APPROVE'], ['reject', 'REJECT']] as const) {
    const { orderId } = await fundedOrder(c, clientOrderId, `${ORDER_NO}-${clientOrderId}`);
    const raw = await sign(orderEmail({ nonce: 'GOB-WRONG1', orderNo: `${ORDER_NO}-${clientOrderId}` }), key.privateKey);
    const control = await submit(c, dir, orderId, clientOrderId, raw, `${ORDER_NO}-${clientOrderId}`);
    assert.equal(control.outcome.verification, 'FAIL');
    assert.equal(control.obligations[0]?.type, 'REVIEW_EVIDENCE');
    assert.equal(control.actions.find(a => a.command === 'review_evidence')?.status, 'AVAILABLE');
    await assert.rejects(c.service.prepare(filler, { command: 'review_evidence', orderId, decision }), code('NOT_FOUND'));
    const plan = await c.service.prepare(buyer, { command: 'review_evidence', orderId, decision });
    await c.service.act(buyer, plan.id, `review-${clientOrderId}`);
    const after = await c.service.inspect(buyer, orderId);
    assert.equal(after.outcome.verification, decision === 'APPROVE' ? 'MANUAL_APPROVED' : 'MANUAL_REJECTED');
    assert.equal(await resultJobs(c, orderId), decision === 'APPROVE' ? 1 : 0);
  }
}));

test('email for a different merchant order than declared fails', () => withContext(async (c, dir) => {
  const { orderId, nonce } = await fundedOrder(c, 'mismatch', '403-9999999-9999999');
  const control = await submit(c, dir, orderId, 'mismatch', await sign(orderEmail({ nonce }), key.privateKey), '403-9999999-9999999');
  assert.equal(control.outcome.verification, 'FAIL');
  assert.equal(await resultJobs(c, orderId), 0);
}));

test('evidence must be uploaded by the assigned filler for that order', () => withContext(async (c, dir) => {
  const { orderId } = await fundedOrder(c, 'auth');
  const raw = Buffer.from('Subject: x\r\n\r\nbody');
  await assert.rejects(storeEvidence(c.store, otherFiller, orderId, raw, dir), code('NOT_FOUND'));
  await assert.rejects(storeEvidence(c.store, filler, orderId, Buffer.from('<html>not an email</html>'), dir), code('EVIDENCE_NOT_EMAIL'));
  const plan = await c.service.prepare(filler, { command: 'submit_evidence', orderId, purchaseOperationId: 'p-auth',
    merchantOrderId: ORDER_NO, evidenceId: 'f'.repeat(64) });
  await assert.rejects(c.service.act(filler, plan.id, 'evidence-missing'), code('EVIDENCE_NOT_FOUND'));
}));
