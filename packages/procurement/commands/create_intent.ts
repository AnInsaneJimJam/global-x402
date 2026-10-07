import { randomUUID } from 'node:crypto';
import { hash } from '../../contracts/index.js';
import type { Handler } from './index.js';
import { fail } from './common.js';

export const createIntent: Handler = {
  role: 'BUYER', path: '/v1/intents',
  eligible(actor, _order, command) {
    if (command.command !== 'create_intent') fail('INVALID_COMMAND');
    if (actor.role !== 'BUYER') fail('ROLE_FORBIDDEN', 403);
    if (BigInt(command.input.fiatMinor) <= 0n || BigInt(command.input.netTokenUnits) <= 0n) fail('INVALID_AMOUNT', 422);
  },
  async apply(db, actor, _order, command) {
    if (command.command !== 'create_intent') fail('INVALID_COMMAND');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`intent:${actor.id}:${command.input.clientOrderId}`]);
    const existing = await db.query('SELECT id FROM gob_orders WHERE buyer_id=$1 AND client_order_id=$2',
      [actor.id, command.input.clientOrderId]);
    if (existing.rowCount) fail('CLIENT_ORDER_CONFLICT');
    const order = { id: randomUUID(), buyerId: actor.id, intent: command.input, termsHash: hash(command.input),
      version: 1, fillerId: null, claimId: null, quote: null, orderNonce: null, escrow: null,
      funding: 'NOT_OBSERVED' as const, purchase: null, evidence: null, verification: null, settlement: null };
    await db.query('INSERT INTO gob_orders(id,buyer_id,client_order_id,data) VALUES ($1,$2,$3,$4)',
      [order.id, actor.id, command.input.clientOrderId, order]);
    return order;
  },
};
