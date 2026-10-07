import type { Handler } from './index.js';
import { fail, requireOrder } from './common.js';

export const registerPurchase: Handler = {
  role: 'FILLER', path: '/v1/orders/:id/purchase-attempts',
  eligible(actor, order, command) {
    if (command.command !== 'register_purchase') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    if (actor.role !== 'FILLER' || current.fillerId !== actor.id) fail('NOT_FOUND', 404);
    if (current.funding !== 'CONFIRMED') fail('FUNDING_NOT_CONFIRMED');
    if (current.purchase) fail(current.purchase.state === 'ORDERED' ? 'PURCHASE_ALREADY_PLACED' : 'UNRESOLVED_PURCHASE');
  },
  async apply(db, actor, order, command) {
    if (command.command !== 'register_purchase') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    const binding = await db.query('INSERT INTO gob_purchase_bindings(actor_id,purchase_operation_id,order_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING order_id',
      [actor.id, command.purchaseOperationId, current.id]);
    if (!binding.rowCount) fail('PURCHASE_OPERATION_CONFLICT');
    current.purchase = { operationId: command.purchaseOperationId, state: 'PREPARED', merchantOrderId: null };
    return current;
  },
};
