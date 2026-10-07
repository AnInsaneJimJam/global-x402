import type { Handler } from './index.js';
import { fail, requireOrder } from './common.js';
import { enqueue } from '../outbox.js';

export const submitEvidence: Handler = {
  role: 'FILLER', path: '/v1/orders/:id/evidence',
  eligible(actor, order, command) {
    if (command.command !== 'submit_evidence') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    if (actor.role !== 'FILLER' || current.fillerId !== actor.id) fail('NOT_FOUND', 404);
    if (current.funding !== 'CONFIRMED') fail('FUNDING_NOT_CONFIRMED');
    if (current.purchase?.state !== 'ORDERED' || current.purchase.operationId !== command.purchaseOperationId ||
      current.purchase.merchantOrderId !== command.merchantOrderId) fail('PURCHASE_REFERENCE_MISMATCH');
    // Corrected evidence may replace FAIL/INCONCLUSIVE; accepted evidence is final.
    if (current.verification?.verdict === 'PASS') fail('EVIDENCE_ALREADY_ACCEPTED');
  },
  async apply(db, actor, order, command) {
    if (command.command !== 'submit_evidence') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    // Only a file this filler uploaded for this order can be bound; object IDs alone confer nothing.
    const file = await db.query<{ size_bytes: number }>(
      'SELECT size_bytes FROM gob_evidence_files WHERE order_id=$1 AND sha256=$2 AND filler_id=$3',
      [current.id, command.evidenceId, actor.id]);
    const sizeBytes = file.rows[0]?.size_bytes ?? fail('EVIDENCE_NOT_FOUND', 404);
    const binding = await db.query<{ order_id: string }>(
      'INSERT INTO gob_evidence_bindings(merchant_id,merchant_order_id,order_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING order_id',
      [current.intent.merchantId, command.merchantOrderId, current.id]);
    if (!binding.rowCount) {
      const prior = await db.query<{ order_id: string }>('SELECT order_id FROM gob_evidence_bindings WHERE merchant_id=$1 AND merchant_order_id=$2',
        [current.intent.merchantId, command.merchantOrderId]);
      if (prior.rows[0]?.order_id !== current.id) fail('EVIDENCE_REPLAY');
    }
    current.evidence = { evidenceId: command.evidenceId, sha256: command.evidenceId, sizeBytes,
      merchantOrderId: command.merchantOrderId, submittedAt: new Date().toISOString() };
    current.verification = null;
    await enqueue(db, { kind: 'verify_evidence', orderId: current.id,
      dedupeKey: `verify:${current.id}:${command.evidenceId}`, payload: { sha256: command.evidenceId } });
    return current;
  },
};
