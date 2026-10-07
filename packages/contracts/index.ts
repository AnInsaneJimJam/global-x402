import { createHash } from 'node:crypto';
import { z } from 'zod';

export const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
const assetIdFormat = z.string().min(1).max(256).regex(/^[a-zA-Z0-9:._-]+$/);
export const assetId = assetIdFormat
  .refine(value => value === (process.env.ESCROW_ASSET_ID ?? 'fixture:test-token'), 'Asset is not configured');
export const actorSchema = z.strictObject({ id, role: z.enum(['BUYER', 'FILLER']) });
export type Actor = z.infer<typeof actorSchema>;
export const intentSchema = z.strictObject({
  clientOrderId: id,
  merchantId: id,
  sku: id,
  // Exact product title as the merchant shows it in the order confirmation (verifier ITEM criterion).
  itemTitle: z.string().min(1).max(300).optional(),
  quantity: z.number().int().min(1).max(100),
  // Only opaque references; no raw delivery information in the prototype.
  recipientRef: id,
  currency: z.enum(['INR', 'SGD', 'USD']),
  fiatMinor: amount,
  netTokenUnits: amount,
  assetId,
  network: z.literal('cardano:preprod'),
});
export const commandSchema = z.discriminatedUnion('command', [
  z.strictObject({ command: z.literal('create_intent'), input: intentSchema }),
  z.strictObject({ command: z.literal('claim'), orderId: id }),
  z.strictObject({ command: z.literal('register_purchase'), orderId: id, purchaseOperationId: id }),
  z.strictObject({ command: z.literal('submit_evidence'), orderId: id, purchaseOperationId: id, merchantOrderId: id,
    evidenceId: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ command: z.literal('review_evidence'), orderId: id, decision: z.enum(['APPROVE', 'REJECT']) }),
  z.strictObject({ command: z.literal('fund_escrow'), orderId: id }),
  z.strictObject({ command: z.literal('request_refund'), orderId: id }),
  z.strictObject({ command: z.literal('authorize_refund'), orderId: id }),
]);
// Private delivery recipient, stored once per buyer reference and revealed only to the funded filler.
// Name is short enough that " GOB-XXXXXX" still fits merchant name fields.
export const recipientSchema = z.strictObject({
  name: z.string().min(1).max(38), line1: z.string().min(1).max(120), line2: z.string().max(120).optional(),
  // State is required: merchant emails (Amazon.in) show only city + state, so both are checked.
  city: z.string().min(1).max(60), state: z.string().min(1).max(60), postalCode: z.string().min(3).max(12),
  country: z.string().regex(/^[A-Z]{2}$/), phone: z.string().max(20).optional(),
});
export type Recipient = z.infer<typeof recipientSchema>;
export type Command = z.infer<typeof commandSchema>;
export const commitSchema = z.strictObject({ planId: id, operationId: id });
export const purchaseObservationSchema = z.strictObject({
  purchaseOperationId: id,
  state: z.enum(['SUBMITTING', 'UNKNOWN', 'ORDERED', 'FAILED_CONFIRMED']),
  merchantOrderId: id.optional(),
}).superRefine((input, ctx) => {
  if (input.state === 'ORDERED' && !input.merchantOrderId) {
    ctx.addIssue({ code: 'custom', message: 'ORDERED requires merchantOrderId' });
  }
});
export type PurchaseState = 'PREPARED' | 'SUBMITTING' | 'UNKNOWN' | 'ORDERED' | 'FAILED_CONFIRMED';
export type Intent = z.infer<typeof intentSchema>;
export type Quote = { fiatMinor: string; rewardMinor: string; grossBaseUnits: string; netBaseUnits: string;
  protocolFeeBaseUnits: string; adaSubsidyLovelace: string; expiresAt: string };
export type Deadlines = { payBy: string; submitResultBy: string; unlockAt: string; externalDisputeUnlockAt: string };
export type Escrow = { escrowId: string; sellerAgentId: string; buyerWalletRef: string; assetId: string;
  grossBaseUnits: string; deadlines: Deadlines; nativeState: string; lastObservedAt: string | null;
  // Settlement adapter execution and the exact terms the buyer echoes when funding (see packages/settlement).
  execution?: 'LIVE' | 'MOCK'; terms?: unknown; txs?: { kind: string; txHash: string; status: string }[] };
export type Evidence = { evidenceId: string; sha256: string; sizeBytes: number; merchantOrderId: string; submittedAt: string };
export type Verification = { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; execution: 'APP_WORKER_DKIM' | 'MANUAL' | 'CRE_SIMULATION' | 'MOCK';
  reviewedBy?: string; criteria: { id: string; expected: string; observed: string | null; result: 'PASS' | 'FAIL' | 'UNKNOWN' }[];
  reasonCodes: string[]; evidenceHash: string; resultHash: string; observedAt: string };
export type Settlement = { state: 'NONE' | 'RESULT_PENDING' | 'DISPUTE_WINDOW' | 'SETTLEMENT_PENDING' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'DISPUTED';
  txs: { kind: string; txHash: string; status: string }[] };
export type Order = {
  id: string; buyerId: string; intent: Intent; termsHash: string;
  version: number; fillerId: string | null; claimId: string | null;
  quote?: Quote | null; orderNonce?: string | null; escrow?: Escrow | null;
  funding: 'NOT_OBSERVED' | 'PENDING' | 'CONFIRMED' | 'RECONCILING';
  // Set by Track A's observer when funding becomes CONFIRMED; lower bound for the order placement time.
  fundedAt?: string | null;
  purchase: { operationId: string; state: PurchaseState; merchantOrderId: string | null } | null;
  // Legacy fixture evidence is a string until Track B replaces its command.
  evidence: Evidence | string | null;
  verification?: Verification | null; settlement?: Settlement | null;
};
export const planSchema = z.strictObject({ id, actor: actorSchema, command: commandSchema,
  effectHash: z.string().regex(/^[a-f0-9]{64}$/), controlVersion: z.number().int().nullable(), expiresAt: z.iso.datetime() });
export type Plan = z.infer<typeof planSchema>;
export const receiptSchema = z.strictObject({ operationId: id, actorId: id,
  command: z.enum(['create_intent', 'claim', 'register_purchase', 'submit_evidence', 'review_evidence', 'fund_escrow',
    'request_refund', 'authorize_refund']),
  effectHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal('SUCCEEDED'), orderId: id, createdAt: z.iso.datetime() });
export type Receipt = z.infer<typeof receiptSchema>;
export const commandDescriptions: Record<Command['command'], { role: Actor['role']; path: string; meaning: string }> = {
  create_intent: { role: 'BUYER', path: '/v1/intents', meaning: 'Persist a fixture intent; no money moves.' },
  claim: { role: 'FILLER', path: '/v1/orders/:id/claims', meaning: 'Reserve one unfunded intent; no money moves.' },
  register_purchase: { role: 'FILLER', path: '/v1/orders/:id/purchase-attempts', meaning: 'Record an obligation before actor-local checkout; registration is not placement.' },
  submit_evidence: { role: 'FILLER', path: '/v1/orders/:id/evidence', meaning: 'Bind an uploaded order-confirmation email to the purchase and queue DKIM verification; acceptance is not proof.' },
  fund_escrow: { role: 'BUYER', path: '/v1/orders/:id/funding', meaning: 'Lock the quoted escrow amount to the claimed filler via the Masumi node; pending until observed on chain.' },
  request_refund: { role: 'BUYER', path: '/v1/orders/:id/refund-requests', meaning: 'Ask the escrow for a refund before the result deadline; the filler may authorize it or it becomes a dispute.' },
  authorize_refund: { role: 'FILLER', path: '/v1/orders/:id/refund-authorizations', meaning: 'Filler agrees to return a requested refund to the buyer.' },
  review_evidence: { role: 'BUYER', path: '/v1/orders/:id/evidence-reviews', meaning: 'Manually approve or reject evidence that did not pass automatic verification; approval allows the result to be submitted.' },
};
export const integration = {
  payment: { protocol: 'MASUMI_NATIVE', network: 'cardano:preprod', execution: 'MOCK', custody: 'OPERATOR_HELD_TEST_WALLETS' },
  merchant: { id: 'fixture-merchant', environment: 'MOCK', checkout: 'AUTOMATED' },
  verifier: { execution: 'MOCK' },
} as const;
const integrationSchema = z.strictObject({
  payment: z.strictObject({ protocol: z.literal('MASUMI_NATIVE'), network: z.literal('cardano:preprod'), execution: z.enum(['LIVE', 'MOCK']),
    custody: z.literal('OPERATOR_HELD_TEST_WALLETS') }),
  merchant: z.strictObject({ id: z.enum(['amazon-in', 'amazon-sg', 'fixture-merchant']), environment: z.enum(['LIVE', 'MOCK']),
    checkout: z.enum(['HUMAN_ASSISTED', 'AUTOMATED']) }),
  verifier: z.strictObject({ execution: z.enum(['APP_WORKER_DKIM', 'MANUAL', 'CRE_SIMULATION', 'MOCK']) }),
});
const purchaseReportSchema = z.strictObject({ operationId: id,
  state: z.enum(['PREPARED', 'SUBMITTING', 'UNKNOWN', 'ORDERED', 'FAILED_CONFIRMED']), merchantOrderId: id.nullable() });
const factState = z.enum(['OBSERVED', 'NOT_OBSERVED', 'UNKNOWN', 'CONTRADICTED']);
const sourceType = z.enum(['MASUMI_NODE', 'CHAIN_OBSERVER', 'ACTOR_REPORT', 'DKIM_EMAIL', 'MANUAL_REVIEW', 'MOCK_CHAIN']);
export const controlSchema = z.strictObject({
  schemaVersion: z.literal('0.2.0'), scope: z.strictObject({ kind: z.literal('order'), id }), viewer: actorSchema,
  controlVersion: z.number().int().positive(), generatedAt: z.iso.datetime(), integration: integrationSchema,
  termsHash: z.string().regex(/^[a-f0-9]{64}$/), claimId: id.nullable(), summary: z.string(),
  outcome: z.strictObject({ placement: z.enum(['ACTOR_REPORTED', 'UNKNOWN']),
    verification: z.enum(['NOT_IMPLEMENTED', 'NOT_STARTED', 'PENDING', 'PASS', 'FAIL', 'INCONCLUSIVE', 'MANUAL_APPROVED', 'MANUAL_REJECTED']),
    settlement: z.enum(['NOT_IMPLEMENTED', 'NONE', 'RESULT_PENDING', 'DISPUTE_WINDOW', 'SETTLEMENT_PENDING', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED']),
    goal: z.literal('OPEN') }),
  facts: z.array(z.discriminatedUnion('key', [
    z.strictObject({ key: z.literal('funding'), state: factState, sourceType, value: z.enum(['NOT_OBSERVED', 'PENDING', 'CONFIRMED', 'RECONCILING']) }),
    z.strictObject({ key: z.literal('escrow'), state: factState, sourceType, value: z.unknown() }),
    z.strictObject({ key: z.literal('merchantPurchase'), state: factState, sourceType, value: purchaseReportSchema.nullable() }),
    z.strictObject({ key: z.literal('evidence'), state: factState, sourceType, value: z.unknown() }),
    z.strictObject({ key: z.literal('verification'), state: factState, sourceType, value: z.unknown() }),
    z.strictObject({ key: z.literal('settlement'), state: factState, sourceType, value: z.unknown() }),
  ])),
  exposure: z.array(z.strictObject({ owner: id, assetId: assetIdFormat, units: amount, kind: z.enum(['FIXTURE_LOCKED', 'ESCROW_LOCKED']) })),
  obligations: z.array(z.strictObject({ type: z.enum(['FUND_ESCROW', 'PLACE_ORDER', 'RECONCILE_PURCHASE', 'SUBMIT_EVIDENCE', 'VERIFY_EVIDENCE',
    'REVIEW_EVIDENCE', 'SUBMIT_RESULT', 'MONITOR_DISPUTE_WINDOW', 'REQUEST_REFUND', 'AUTHORIZE_REFUND', 'COLLECT']),
    owner: id.nullable(), operationId: id.optional() })),
  actions: z.array(z.strictObject({ command: z.enum(['create_intent', 'claim', 'register_purchase', 'submit_evidence', 'fund_escrow',
    'review_evidence', 'request_refund', 'authorize_refund']), status: z.enum(['AVAILABLE', 'BLOCKED']),
    reasonCodes: z.array(z.string()), requiredAuthority: z.string().optional() })),
});

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
export function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export class DomainError extends Error {
  constructor(public code: string, public status = 409,
    public recovery: 'REFRESH' | 'RECONCILE' | 'REAUTHORIZE' | 'CHANGE_INPUT' = 'REFRESH') {
    super(code);
  }
}

export function capabilities() {
  return {
    // `integration` is the default for fixture orders; each control view carries that order's own labels.
    contractVersion: '0.2.0', schemaHash: hash(z.toJSONSchema(commandSchema)), integration,
    merchants: [{ id: 'amazon-in', environment: 'LIVE', checkout: 'HUMAN_ASSISTED', verifier: 'APP_WORKER_DKIM',
      tested: 'SYNTHETIC_EMAILS_AND_ONE_REVOKED_KEY_EMAIL_ONLY' }],
    commands: ['create_intent', 'claim', 'register_purchase', 'submit_evidence', 'review_evidence', 'fund_escrow', 'request_refund', 'authorize_refund'],
    configured: true, tested: false, availableNow: true,
    scope: 'LOCAL_CONTROL_CONTRACT_ONLY',
    blockers: ['LIVE_FUNDING_UNVALIDATED', 'LIVE_DKIM_PASS_UNVERIFIED', 'MERCHANT_NONCE_IN_SHIP_TO_UNVERIFIED', 'CRE_NOT_CONNECTED',
      'WALLET_AUTH_NOT_IMPLEMENTED'],
    schemas: '/v1/capabilities/commands',
  };
}
