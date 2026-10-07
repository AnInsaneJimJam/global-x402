import type pg from 'pg';
import type { Actor, Command, Order } from '../../contracts/index.js';
import { createIntent } from './create_intent.js';
import { claim } from './claim.js';
import { registerPurchase } from './register_purchase.js';
import { submitEvidence } from './submit_evidence.js';
import { reviewEvidence } from './review_evidence.js';

export type Handler = {
  role: Actor['role'];
  path: string;
  eligible(actor: Actor, order: Order | null, command: Command): void;
  apply(db: pg.PoolClient, actor: Actor, order: Order | null, command: Command): Promise<Order>;
};

export const handlers: Record<Command['command'], Handler> = {
  create_intent: createIntent,
  claim,
  register_purchase: registerPurchase,
  submit_evidence: submitEvidence,
  review_evidence: reviewEvidence,
};
