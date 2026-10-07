import { randomInt, randomUUID } from 'node:crypto';
import { hash } from '../../contracts/index.js';
import type { Handler } from './index.js';
import { fail, requireOrder } from './common.js';
import { enqueue } from '../outbox.js';

const NONCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: typed by hand into checkout forms

export const claim: Handler = {
  role: 'FILLER', path: '/v1/orders/:id/claims',
  eligible(actor, order, command) {
    if (command.command !== 'claim') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    if (actor.role !== 'FILLER') fail('ROLE_FORBIDDEN', 403);
    if (current.fillerId) fail('ALREADY_CLAIMED');
  },
  async apply(db, actor, order, command) {
    if (command.command !== 'claim') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    current.fillerId = actor.id;
    current.claimId = randomUUID();
    current.termsHash = hash({ intent: current.intent, buyerId: current.buyerId,
      fillerId: current.fillerId, claimId: current.claimId });
    // The filler appends this to the recipient name at checkout; the merchant echoes it back in the
    // confirmation email, binding that order to this assignment. Unique index enforces no reuse.
    current.orderNonce = `GOB-${Array.from({ length: 6 }, () => NONCE_ALPHABET[randomInt(NONCE_ALPHABET.length)]).join('')}`;
    // Ask the filler's node for a payment request bound to these exact terms (settlement worker).
    await enqueue(db, { kind: 'create_escrow_terms', orderId: current.id, dedupeKey: `terms:${current.id}:${current.claimId}`, payload: {} });
    return current;
  },
};
