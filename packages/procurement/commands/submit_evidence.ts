import type { Handler } from './index.js';
import { fail, requireOrder } from './common.js';

export const submitEvidence: Handler = {
  role: 'FILLER', path: '/v1/orders/:id/evidence',
  eligible(actor, order, command) {
    if (command.command !== 'submit_evidence') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    if (actor.role !== 'FILLER' || current.fillerId !== actor.id) fail('NOT_FOUND', 404);
    if (current.funding !== 'CONFIRMED') fail('FUNDING_NOT_CONFIRMED');
    if (current.purchase?.state !== 'ORDERED' || current.purchase.operationId !== command.purchaseOperationId ||
      current.purchase.merchantOrderId !== command.merchantOrderId) fail('PURCHASE_REFERENCE_MISMATCH');
  },
  async apply(db, _actor, order, command) {
    if (command.command !== 'submit_evidence') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    const binding = await db.query<{ order_id: string }>(
      'INSERT INTO gob_evidence_bindings(merchant_id,merchant_order_id,order_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING order_id',
      [current.intent.merchantId, command.merchantOrderId, current.id]);
    if (!binding.rowCount) {
      const prior = await db.query<{ order_id: string }>('SELECT order_id FROM gob_evidence_bindings WHERE merchant_id=$1 AND merchant_order_id=$2',
        [current.intent.merchantId, command.merchantOrderId]);
      if (prior.rows[0]?.order_id !== current.id) fail('EVIDENCE_REPLAY');
    }
    current.evidence = command.merchantOrderId;
    return current;
  },
};
