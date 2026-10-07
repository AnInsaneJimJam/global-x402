import type { Handler } from './index.js';
import { fail, requireOrder } from './common.js';
import { enqueue } from '../outbox.js';
import { resultHashOf } from '../evidence.js';

// Buyer's manual decision on evidence that did not pass automatic verification. Labeled MANUAL;
// it never masquerades as DKIM/CRE verification.
export const reviewEvidence: Handler = {
  role: 'BUYER', path: '/v1/orders/:id/evidence-reviews',
  eligible(actor, order, command) {
    if (command.command !== 'review_evidence') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    if (actor.role !== 'BUYER' || current.buyerId !== actor.id) fail('NOT_FOUND', 404);
    const v = current.verification ?? fail('NOTHING_TO_REVIEW');
    if (v.verdict === 'PASS') fail('EVIDENCE_ALREADY_ACCEPTED');
    if (v.execution === 'MANUAL') fail('ALREADY_REVIEWED');
  },
  async apply(db, actor, order, command) {
    if (command.command !== 'review_evidence') fail('INVALID_COMMAND');
    const current = requireOrder(order);
    const prior = current.verification ?? fail('NOTHING_TO_REVIEW');
    const decided = { ...prior, verdict: command.decision === 'APPROVE' ? 'PASS' as const : 'FAIL' as const,
      execution: 'MANUAL' as const, reviewedBy: actor.id, observedAt: new Date().toISOString() };
    current.verification = { ...decided, resultHash: resultHashOf(current, decided) };
    if (decided.verdict === 'PASS') {
      await enqueue(db, { kind: 'submit_result', orderId: current.id,
        dedupeKey: `result:${current.id}:${current.verification.resultHash}`, payload: { resultHash: current.verification.resultHash } });
    }
    return current;
  },
};
