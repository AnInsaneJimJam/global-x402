import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Order, Recipient, Verification } from '../../../packages/contracts/index.js';
import type { MerchantConfig } from '../../../packages/merchants/index.js';
import { amazonIn } from '../../../packages/merchants/amazon-in.js';
import { enqueue } from '../../../packages/procurement/outbox.js';
import { readEvidence, resultHashOf } from '../../../packages/procurement/evidence.js';
import { verifyOrderEmail } from '../../../packages/verification/index.js';
import type { DkimKeyResolver } from '../../../packages/verification/index.js';
import { dohResolver } from '../../../packages/verification/doh.js';
import type { JobHandler } from './index.js';
import type { Store } from '../../../packages/procurement/store.js';

const run = promisify(execFile);
const payload = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) });

// What the evidence must show for this order (shared by the local check and the CRE workflow's input).
export function expectedFor(order: Order, recipient: Recipient | undefined, merchantOrderId: string) {
  return { orderId: order.id, claimId: order.claimId ?? '', termsHash: order.termsHash, nonce: order.orderNonce ?? '',
    merchantId: order.intent.merchantId,
    // Missing recipient leaves these empty, which the verifier treats as UNKNOWN (never PASS).
    recipientName: recipient && order.orderNonce ? `${order.orderNonce} ${recipient.name}` : '',
    recipientCity: recipient?.city ?? '', recipientRegion: recipient?.state ?? '',
    itemMatch: order.intent.itemTitle ?? order.intent.sku, quantity: order.intent.quantity,
    totalMinor: order.intent.fiatMinor, currency: order.intent.currency,
    fundedAt: order.fundedAt ?? '', purchaseDeadline: order.escrow?.deadlines.submitResultBy ?? '', merchantOrderId };
}

// Records a verdict for the evidence that is still current; PASS enqueues the escrow result in the same transaction.
export async function recordVerification(store: Store, orderId: string, sha256: string,
  result: Pick<Verification, 'verdict' | 'criteria' | 'reasonCodes' | 'evidenceHash' | 'observedAt'>, execution: Verification['execution']) {
  return store.transaction(async db => {
    const order = (await db.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0]?.data;
    const current = order && typeof order.evidence === 'object' ? order.evidence : null;
    if (!order || current?.sha256 !== sha256 || order.verification || result.evidenceHash !== sha256) return false;
    const decided = { verdict: result.verdict, execution, criteria: result.criteria, reasonCodes: result.reasonCodes,
      evidenceHash: result.evidenceHash, observedAt: result.observedAt };
    const verification: Verification = { ...decided, resultHash: resultHashOf(order, decided) };
    order.verification = verification;
    order.version++;
    await db.query('UPDATE gob_orders SET data=$2 WHERE id=$1', [order.id, order]);
    if (verification.verdict === 'PASS') {
      await enqueue(db, { kind: 'submit_result', orderId: order.id,
        dedupeKey: `result:${order.id}:${verification.resultHash}`, payload: { resultHash: verification.resultHash } });
    }
    return true;
  });
}

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
    const recipient = (await store.pool.query<{ data: Recipient }>('SELECT data FROM gob_recipients WHERE buyer_id=$1 AND ref=$2',
      [snapshot.buyerId, snapshot.intent.recipientRef])).rows[0]?.data;
    const result = merchant ? await verifyOrderEmail({
      raw: await readEvidence(snapshot.id, sha256, deps.evidenceDir, store), merchant, resolveDkimKey: deps.resolveDkimKey, now,
      expected: expectedFor(snapshot, recipient, evidence.merchantOrderId),
    }) : { verdict: 'INCONCLUSIVE' as const, reasonCodes: ['MERCHANT_NOT_SUPPORTED'], evidenceHash: sha256, observedAt: now.toISOString(),
      criteria: [{ id: 'MERCHANT', expected: snapshot.intent.merchantId, observed: null, result: 'UNKNOWN' as const }] };
    await recordVerification(store, snapshot.id, sha256, result, 'APP_WORKER_DKIM');
  };
}

// VERIFIER=CRE: the verdict is computed by the Chainlink CRE workflow (workflows/cre-verify, local simulation),
// which fetches the evidence from the API and posts its verdict back (recorded as CRE_SIMULATION).
const creVerify: JobHandler = async (job, store) => {
  const { sha256 } = payload.parse(job.payload);
  const order = (await store.pool.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1', [job.orderId])).rows[0]?.data;
  const evidence = order && typeof order.evidence === 'object' ? order.evidence : null;
  if (!order || evidence?.sha256 !== sha256 || order.verification) return;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const { stdout } = await run(process.env.CRE_BIN ?? `${homedir()}/.cre/bin/cre`, ['workflow', 'simulate', 'verify-order',
    '--non-interactive', '--trigger-index', '0', '--skip-type-checks', '--target', 'staging-settings',
    '--http-payload', JSON.stringify({ orderId: order.id, sha256 }), '-R', `${root}workflows/cre-verify`, '-e', process.env.CRE_ENV_FILE ?? `${root}.env`],
  { cwd: `${root}workflows/cre-verify`, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  // Show the CRE run in the worker terminal (check ids/results only; observed values stay out of logs).
  for (const line of stdout.split('\n').filter(l => /\[USER LOG\]|Workflow compiled|Binary hash|Running trigger|TEE|Nitro|not a real TEE/.test(l))) console.log(`[cre] ${line.trim()}`);
  const after = (await store.pool.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1', [job.orderId])).rows[0]?.data;
  if (!after?.verification) throw new Error('CRE simulation finished without recording a verdict; raw CLI output suppressed');
};

export const verifyEvidence = process.env.VERIFIER === 'CRE' ? creVerify : verifyEvidenceJob({ merchants: { 'amazon-in': amazonIn }, resolveDkimKey: dohResolver() });
