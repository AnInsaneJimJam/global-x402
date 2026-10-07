import type { Handler } from './index.js';
import { fail, requireOrder } from './common.js';
import { enqueue } from '../outbox.js';

const OPEN = new Set(['NONE', 'RESULT_PENDING', 'DISPUTE_WINDOW']);

export const requestRefund: Handler = {
  role: 'BUYER', path: '/v1/orders/:id/refund-requests',
  eligible(actor, order, command) {
    if (command.command !== 'request_refund') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    if (actor.role !== 'BUYER' || current.buyerId !== actor.id) fail('NOT_FOUND', 404);
    if (current.funding !== 'CONFIRMED' || !current.escrow) fail('FUNDING_NOT_CONFIRMED');
    if (!OPEN.has(current.settlement?.state ?? 'NONE')) fail('SETTLEMENT_NOT_REFUNDABLE');
  },
  async apply(db, _actor, order, command) {
    if (command.command !== 'request_refund') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    current.settlement = { state: 'REFUND_PENDING', txs: current.settlement?.txs ?? [] };
    await enqueue(db, { kind: 'request_refund', orderId: current.id, dedupeKey: `refund-request:${current.id}`, payload: {} });
    return current;
  },
};
