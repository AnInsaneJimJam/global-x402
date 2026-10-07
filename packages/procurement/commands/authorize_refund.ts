import type { Handler } from './index.js';
import { fail, requireOrder } from './common.js';
import { enqueue } from '../outbox.js';

export const authorizeRefund: Handler = {
  role: 'FILLER', path: '/v1/orders/:id/refund-authorizations',
  eligible(actor, order, command) {
    if (command.command !== 'authorize_refund') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    if (actor.role !== 'FILLER' || current.fillerId !== actor.id) fail('NOT_FOUND', 404);
    if (current.settlement?.state !== 'REFUND_PENDING' && current.settlement?.state !== 'DISPUTED') fail('NO_REFUND_REQUESTED');
  },
  async apply(db, _actor, order, command) {
    if (command.command !== 'authorize_refund') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    await enqueue(db, { kind: 'authorize_refund', orderId: current.id, dedupeKey: `refund-authorize:${current.id}`, payload: {} });
    return current;
  },
};
