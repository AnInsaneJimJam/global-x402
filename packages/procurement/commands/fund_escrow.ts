import type { Handler } from './index.js';
import { fail, requireOrder } from './common.js';
import { enqueue } from '../outbox.js';

// Buyer authorizes locking the quoted amount to the claimed filler. The node's purchasing wallet signs;
// funding stays PENDING until the chain observer sees the lock.
export const fundEscrow: Handler = {
  role: 'BUYER', path: '/v1/orders/:id/funding',
  eligible(actor, order, command) {
    if (command.command !== 'fund_escrow') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    if (actor.role !== 'BUYER' || current.buyerId !== actor.id) fail('NOT_FOUND', 404);
    if (!current.escrow?.terms) fail('ESCROW_TERMS_NOT_READY');
    if (current.funding !== 'NOT_OBSERVED') fail('FUNDING_ALREADY_STARTED');
    // Leave room for the node's batch job and confirmation before payBy.
    if (Date.parse(current.escrow.deadlines.payBy) - Date.now() < 2 * 60_000) fail('PAY_BY_TOO_CLOSE');
  },
  async apply(db, _actor, order, command) {
    if (command.command !== 'fund_escrow') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    current.funding = 'PENDING';
    await enqueue(db, { kind: 'fund_escrow', orderId: current.id, dedupeKey: `fund:${current.id}:${current.escrow!.escrowId}`, payload: {} });
    return current;
  },
};
