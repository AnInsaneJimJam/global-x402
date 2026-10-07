import { z } from 'zod';
import { DomainError, id } from '../contracts/index.js';
import type { Order, Recipient } from '../contracts/index.js';
import { expectedFor } from '../../apps/worker/jobs/verify_evidence.js';
import { readEvidence } from './evidence.js';
import type { Store } from './store.js';

// Input for the CRE verification workflow: the uploaded email (base64) and what it must show.
export async function creEvidence(store: Store, orderId: string, sha256: string) {
  const order = (await store.pool.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1', [id.parse(orderId)])).rows[0]?.data;
  const evidence = order && typeof order.evidence === 'object' ? order.evidence : null;
  if (!order || evidence?.sha256 !== sha256 || order.verification) throw new DomainError('NOT_FOUND', 404);
  const recipient = (await store.pool.query<{ data: Recipient }>('SELECT data FROM gob_recipients WHERE buyer_id=$1 AND ref=$2',
    [order.buyerId, order.intent.recipientRef])).rows[0]?.data;
  return { orderId: order.id, sha256, merchantId: order.intent.merchantId,
    emlBase64: (await readEvidence(order.id, sha256, undefined, store)).toString('base64'), expected: expectedFor(order, recipient, evidence.merchantOrderId) };
}

const criterion = z.strictObject({ id: z.string().max(64), expected: z.string().max(400), observed: z.string().max(400).nullable(),
  result: z.enum(['PASS', 'FAIL', 'UNKNOWN']) });
export const creResultSchema = z.strictObject({ orderId: id, sha256: z.string().regex(/^[a-f0-9]{64}$/), result: z.object({
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), criteria: z.array(criterion).max(32), reasonCodes: z.array(z.string().max(80)).max(32),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), observedAt: z.string().max(40) }) });
