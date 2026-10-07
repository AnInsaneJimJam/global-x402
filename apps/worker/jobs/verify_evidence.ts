import { z } from 'zod';
import type { Order, Verification } from '../../../packages/contracts/index.js';
import type { MerchantConfig } from '../../../packages/merchants/index.js';
import { amazonIn } from '../../../packages/merchants/amazon-in.js';
import { enqueue } from '../../../packages/procurement/outbox.js';
import { readEvidence, resultHashOf } from '../../../packages/procurement/evidence.js';
import { verifyOrderEmail } from '../../../packages/verification/index.js';
import type { DkimKeyResolver } from '../../../packages/verification/index.js';
import { dohResolver } from '../../../packages/verification/doh.js';
import type { JobHandler } from './index.js';

const payload = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) });

// Runs the DKIM verifier for the currently submitted evidence. Verification (network) happens outside
// any transaction; the result is written under the order lock only if that evidence is still current.
// PASS enqueues Track A's submit_result in the same transaction.
export function verifyEvidenceJob(deps: { merchants: Record<string, MerchantConfig>; resolveDkimKey: DkimKeyResolver;
  evidenceDir?: string; now?: () => Date }): JobHandler {
  return async (job, store) => {
    const { sha256 } = payload.parse(job.payload);
    const snapshot = (await store.pool.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1', [job.orderId])).rows[0]?.data;
    const evidence = snapshot && typeof snapshot.evidence === 'object' ? snapshot.evidence : null;
    if (!snapshot || evidence?.sha256 !== sha256 || snapshot.verification) return; // superseded or already decided
    const merchant = deps.merchants[snapshot.intent.merchantId];
    const now = deps.now?.() ?? new Date();
    const result = merchant ? await verifyOrderEmail({
      raw: await readEvidence(snapshot.id, sha256, deps.evidenceDir), merchant, resolveDkimKey: deps.resolveDkimKey, now,
      expected: { orderId: snapshot.id, claimId: snapshot.claimId ?? '', termsHash: snapshot.termsHash,
        nonce: snapshot.orderNonce ?? '', merchantId: snapshot.intent.merchantId,
        itemMatch: snapshot.intent.itemTitle ?? snapshot.intent.sku, quantity: snapshot.intent.quantity,
        totalMinor: snapshot.intent.fiatMinor, currency: snapshot.intent.currency,
        fundedAt: snapshot.fundedAt ?? '', purchaseDeadline: snapshot.escrow?.deadlines.submitResultBy ?? '',
        merchantOrderId: evidence.merchantOrderId },
    }) : { verdict: 'INCONCLUSIVE' as const, reasonCodes: ['MERCHANT_NOT_SUPPORTED'], evidenceHash: sha256, observedAt: now.toISOString(),
      criteria: [{ id: 'MERCHANT', expected: snapshot.intent.merchantId, observed: null, result: 'UNKNOWN' as const }] };
    await store.transaction(async db => {
      const order = (await db.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1 FOR UPDATE', [job.orderId])).rows[0]?.data;
      const current = order && typeof order.evidence === 'object' ? order.evidence : null;
      if (!order || current?.sha256 !== sha256 || order.verification) return;
      const decided = { verdict: result.verdict, execution: 'APP_WORKER_DKIM' as const, criteria: result.criteria,
        reasonCodes: result.reasonCodes, evidenceHash: result.evidenceHash, observedAt: result.observedAt };
      const verification: Verification = { ...decided, resultHash: resultHashOf(order, decided) };
      order.verification = verification;
      order.version++;
      await db.query('UPDATE gob_orders SET data=$2 WHERE id=$1', [order.id, order]);
      if (verification.verdict === 'PASS') {
        await enqueue(db, { kind: 'submit_result', orderId: order.id,
          dedupeKey: `result:${order.id}:${verification.resultHash}`, payload: { resultHash: verification.resultHash } });
      }
    });
  };
}

export const verifyEvidence = verifyEvidenceJob({ merchants: { 'amazon-in': amazonIn }, resolveDkimKey: dohResolver() });
