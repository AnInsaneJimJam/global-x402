import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DomainError, hash, id, recipientSchema } from '../contracts/index.js';
import type { Actor, Order, Recipient, Verification } from '../contracts/index.js';
import type { Store } from './store.js';

// Track B: private recipient storage, evidence files, and the verification slice of the control view.
function fail(code: string, status = 409): never { throw new DomainError(code, status); }
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const MAX_UPLOADS_PER_ORDER = 5;
export const evidenceDir = () => process.env.EVIDENCE_DIR ?? '.evidence';

// What gets written on-chain as the result: binds the verdict to this exact assignment and evidence.
export function resultHashOf(order: Order, v: Pick<Verification, 'evidenceHash' | 'verdict' | 'criteria' | 'reviewedBy'>) {
  return hash({ orderId: order.id, claimId: order.claimId, termsHash: order.termsHash, evidenceHash: v.evidenceHash,
    verdict: v.verdict, criteria: v.criteria, reviewedBy: v.reviewedBy ?? null });
}

async function load(store: Store, orderId: string): Promise<Order> {
  const row = await store.pool.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1', [id.parse(orderId)]);
  return row.rows[0]?.data ?? fail('NOT_FOUND', 404);
}

// Insert-only: a recipient is part of the delivery terms and cannot change under a claim.
export async function putRecipient(store: Store, actor: Actor, ref: string, input: unknown) {
  if (actor.role !== 'BUYER') fail('ROLE_FORBIDDEN', 403);
  const data = recipientSchema.parse(input);
  const row = await store.pool.query<{ data: Recipient }>(
    `INSERT INTO gob_recipients(buyer_id,ref,data) VALUES ($1,$2,$3)
     ON CONFLICT (buyer_id,ref) DO UPDATE SET ref=EXCLUDED.ref RETURNING data`, [actor.id, id.parse(ref), data]);
  if (hash(row.rows[0]!.data) !== hash(data)) fail('RECIPIENT_IMMUTABLE');
  return { ref, stored: true };
}

// Delivery details for checkout: buyer always; assigned filler only after confirmed funding.
export async function assignment(store: Store, actor: Actor, orderId: string) {
  const order = await load(store, orderId);
  const isBuyer = actor.role === 'BUYER' && actor.id === order.buyerId;
  const isFiller = actor.role === 'FILLER' && actor.id === order.fillerId;
  if (!isBuyer && !isFiller) fail('NOT_FOUND', 404);
  if (isFiller && order.funding !== 'CONFIRMED') fail('FUNDING_NOT_CONFIRMED');
  if (!order.orderNonce) fail('NOT_CLAIMED');
  const row = await store.pool.query<{ data: Recipient }>('SELECT data FROM gob_recipients WHERE ref=$1 AND buyer_id=$2',
    [order.intent.recipientRef, order.buyerId]);
  const recipient = row.rows[0]?.data ?? fail('RECIPIENT_NOT_PROVIDED');
  return {
    orderId: order.id, merchantId: order.intent.merchantId, sku: order.intent.sku, itemTitle: order.intent.itemTitle ?? null,
    quantity: order.intent.quantity, currency: order.intent.currency, maximumChargeMinor: order.intent.fiatMinor,
    nonce: order.orderNonce,
    recipient: { ...recipient, name: `${recipient.name} ${order.orderNonce}` },
    instructions: 'Order exactly this item and quantity from your own account, ship to this recipient using the name exactly as shown (including the GOB code), then upload the original confirmation email (.eml).',
  };
}

// Stores the raw email privately; the returned evidenceId is its sha256. Only the funded assigned filler may upload.
export async function storeEvidence(store: Store, actor: Actor, orderId: string, bytes: Buffer, dir = evidenceDir()) {
  const order = await load(store, orderId);
  if (actor.role !== 'FILLER' || actor.id !== order.fillerId) fail('NOT_FOUND', 404);
  if (order.funding !== 'CONFIRMED') fail('FUNDING_NOT_CONFIRMED');
  // Uploads only between a reported placement and a final decision, and at most a few per order.
  if (order.purchase?.state !== 'ORDERED') fail('PURCHASE_NOT_ORDERED');
  if (order.verification?.verdict === 'PASS' || order.verification?.execution === 'MANUAL') fail('EVIDENCE_FINAL');
  // ponytail: count-then-insert can overshoot by one under concurrent uploads; fine for a per-order cap.
  const uploads = await store.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM gob_evidence_files WHERE order_id=$1', [order.id]);
  if ((uploads.rows[0]?.n ?? 0) >= MAX_UPLOADS_PER_ORDER) fail('EVIDENCE_LIMIT', 429);
  if (bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES) fail('EVIDENCE_SIZE', 413);
  if (!/^[\x21-\x39\x3b-\x7e]+:/.test(bytes.subarray(0, 200).toString('latin1'))) fail('EVIDENCE_NOT_EMAIL', 415);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const folder = join(dir, order.id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try { await writeFile(join(folder, `${sha256}.eml`), bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await store.pool.query(`INSERT INTO gob_evidence_files(order_id,sha256,filler_id,size_bytes) VALUES ($1,$2,$3,$4)
    ON CONFLICT DO NOTHING`, [order.id, sha256, actor.id, bytes.length]);
  return { evidenceId: sha256, sha256, sizeBytes: bytes.length };
}

export function readEvidence(orderId: string, sha256: string, dir = evidenceDir()) {
  return readFile(join(dir, id.parse(orderId), `${/^[a-f0-9]{64}$/.test(sha256) ? sha256 : fail('INVALID_EVIDENCE_ID', 400)}.eml`));
}

// Verification part of the control view, kept here so service.inspect only splices it in.
export function verificationView(order: Order, actor: Actor) {
  const evidence = typeof order.evidence === 'object' ? order.evidence : null;
  const v = order.verification ?? null;
  const manual = v?.execution === 'MANUAL';
  const outcome = !evidence ? 'NOT_STARTED' as const : !v ? 'PENDING' as const :
    manual ? (v.verdict === 'PASS' ? 'MANUAL_APPROVED' as const : 'MANUAL_REJECTED' as const) : v.verdict;
  const reviewable = !!v && v.verdict !== 'PASS' && !manual;
  const isBuyer = actor.role === 'BUYER' && actor.id === order.buyerId;
  return {
    outcome,
    facts: [
      ...(evidence ? [{ key: 'evidence' as const, state: 'OBSERVED' as const, sourceType: 'ACTOR_REPORT' as const,
        value: { evidenceId: evidence.evidenceId, merchantOrderId: evidence.merchantOrderId, submittedAt: evidence.submittedAt } }] : []),
      ...(v ? [{ key: 'verification' as const, state: 'OBSERVED' as const,
        sourceType: manual ? 'MANUAL_REVIEW' as const : 'DKIM_EMAIL' as const,
        value: { verdict: v.verdict, execution: v.execution, reasonCodes: v.reasonCodes, criteria: v.criteria, observedAt: v.observedAt } }] : []),
    ],
    obligations: evidence && !v ? [{ type: 'VERIFY_EVIDENCE' as const, owner: 'verifier-worker' }] :
      reviewable ? [{ type: 'REVIEW_EVIDENCE' as const, owner: order.buyerId }] : [],
    action: { command: 'review_evidence' as const, status: reviewable && isBuyer ? 'AVAILABLE' as const : 'BLOCKED' as const,
      reasonCodes: reviewable ? (isBuyer ? [] : ['ROLE_FORBIDDEN']) : [v ? 'NOTHING_TO_REVIEW' : 'VERIFICATION_NOT_COMPLETE'] },
  };
}
