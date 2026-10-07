import { randomUUID } from 'node:crypto';
import { hash } from '../../contracts/index.js';
import type { Handler } from './index.js';
import { fail, requireOrder } from './common.js';

export const claim: Handler = {
  role: 'FILLER', path: '/v1/orders/:id/claims',
  eligible(actor, order, command) {
    if (command.command !== 'claim') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    if (actor.role !== 'FILLER') fail('ROLE_FORBIDDEN', 403);
    if (current.fillerId) fail('ALREADY_CLAIMED');
  },
  async apply(_db, actor, order, command) {
    if (command.command !== 'claim') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    current.fillerId = actor.id;
    current.claimId = randomUUID();
    current.termsHash = hash({ intent: current.intent, buyerId: current.buyerId,
      fillerId: current.fillerId, claimId: current.claimId });
    return current;
  },
};
