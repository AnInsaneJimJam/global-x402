import { createHash } from 'node:crypto';
import { z } from 'zod';

export const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const actorSchema = z.strictObject({ id, role: z.enum(['BUYER', 'FILLER']) });
export type Actor = z.infer<typeof actorSchema>;
export const intentSchema = z.strictObject({
  clientOrderId: id,
  merchantId: id,
  sku: id,
  quantity: z.number().int().min(1).max(100),
  // Only opaque references; no raw delivery information in the prototype.
  recipientRef: id,
  currency: z.literal('USD'),
  fiatMinor: amount,
  netTokenUnits: amount,
  assetId: z.literal('fixture:test-token'),
  network: z.literal('cardano:preprod'),
});
export const commandSchema = z.discriminatedUnion('command', [
  z.strictObject({ command: z.literal('create_intent'), input: intentSchema }),
  z.strictObject({ command: z.literal('claim'), orderId: id }),
  z.strictObject({ command: z.literal('register_purchase'), orderId: id, purchaseOperationId: id }),
  z.strictObject({ command: z.literal('submit_evidence'), orderId: id, purchaseOperationId: id, merchantOrderId: id }),
]);
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
export type Order = {
  id: string; buyerId: string; intent: Intent; termsHash: string;
  version: number; fillerId: string | null; claimId: string | null;
  funding: 'NOT_OBSERVED' | 'CONFIRMED';
  purchase: { operationId: string; state: PurchaseState; merchantOrderId: string | null } | null;
  evidence: string | null;
};
export const planSchema = z.strictObject({ id, actor: actorSchema, command: commandSchema,
  effectHash: z.string().regex(/^[a-f0-9]{64}$/), controlVersion: z.number().int().nullable(), expiresAt: z.iso.datetime() });
export type Plan = z.infer<typeof planSchema>;
export const receiptSchema = z.strictObject({ operationId: id, actorId: id,
  command: z.enum(['create_intent', 'claim', 'register_purchase', 'submit_evidence']),
  effectHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal('SUCCEEDED'), orderId: id, createdAt: z.iso.datetime() });
export type Receipt = z.infer<typeof receiptSchema>;
export const commandDescriptions: Record<Command['command'], { role: Actor['role']; path: string; meaning: string }> = {
  create_intent: { role: 'BUYER', path: '/v1/intents', meaning: 'Persist a fixture intent; no money moves.' },
  claim: { role: 'FILLER', path: '/v1/orders/:id/claims', meaning: 'Reserve one unfunded intent; no money moves.' },
  register_purchase: { role: 'FILLER', path: '/v1/orders/:id/purchase-attempts', meaning: 'Record an obligation before actor-local checkout; registration is not placement.' },
  submit_evidence: { role: 'FILLER', path: '/v1/orders/:id/evidence', meaning: 'Bind an actor-reported merchant order for future verification; acceptance is not proof.' },
};
export const integration = {
  payment: { protocol: 'X402_MASUMI', network: 'cardano:preprod', execution: 'MOCK' },
  merchant: { environment: 'MOCK', checkout: 'AUTOMATED' },
  verifier: { execution: 'MOCK' },
} as const;
const integrationSchema = z.strictObject({
  payment: z.strictObject({ protocol: z.literal('X402_MASUMI'), network: z.literal('cardano:preprod'), execution: z.literal('MOCK') }),
  merchant: z.strictObject({ environment: z.literal('MOCK'), checkout: z.literal('AUTOMATED') }),
  verifier: z.strictObject({ execution: z.literal('MOCK') }),
});
const purchaseReportSchema = z.strictObject({ operationId: id,
  state: z.enum(['PREPARED', 'SUBMITTING', 'UNKNOWN', 'ORDERED', 'FAILED_CONFIRMED']), merchantOrderId: id.nullable() });
const factState = z.enum(['OBSERVED', 'NOT_OBSERVED', 'UNKNOWN', 'CONTRADICTED']);
export const controlSchema = z.strictObject({
  schemaVersion: z.literal('0.1.0'), scope: z.strictObject({ kind: z.literal('order'), id }), viewer: actorSchema,
  controlVersion: z.number().int().positive(), generatedAt: z.iso.datetime(), integration: integrationSchema,
  termsHash: z.string().regex(/^[a-f0-9]{64}$/), claimId: id.nullable(), summary: z.string(),
  outcome: z.strictObject({ placement: z.enum(['ACTOR_REPORTED', 'UNKNOWN']), verification: z.literal('NOT_IMPLEMENTED'),
    settlement: z.literal('NOT_IMPLEMENTED'), goal: z.literal('OPEN') }),
  facts: z.array(z.discriminatedUnion('key', [
    z.strictObject({ key: z.literal('funding'), state: factState, sourceType: z.literal('MOCK_CHAIN'), value: z.enum(['NOT_OBSERVED', 'CONFIRMED']) }),
    z.strictObject({ key: z.literal('merchantPurchase'), state: factState, sourceType: z.literal('ACTOR_REPORT'), value: purchaseReportSchema.nullable() }),
  ])),
  exposure: z.array(z.strictObject({ owner: id, assetId: z.literal('fixture:test-token'), units: amount, kind: z.literal('FIXTURE_LOCKED') })),
  obligations: z.array(z.strictObject({ type: z.enum(['RECONCILE_PURCHASE', 'VERIFY_EVIDENCE', 'SUBMIT_EVIDENCE']),
    owner: id.nullable(), operationId: id.optional() })),
  actions: z.array(z.strictObject({ command: z.enum(['register_purchase', 'fund_escrow']), status: z.enum(['AVAILABLE', 'BLOCKED']),
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
    contractVersion: '0.1.0', schemaHash: hash(z.toJSONSchema(commandSchema)), integration,
    commands: ['create_intent', 'claim', 'register_purchase', 'submit_evidence'],
    configured: true, tested: false, availableNow: true,
    scope: 'LOCAL_CONTROL_CONTRACT_ONLY',
    blockers: ['LIVE_FUNDING_UNVALIDATED', 'MERCHANT_NOT_SELECTED', 'CRE_NOT_CONNECTED', 'WALLET_AUTH_NOT_IMPLEMENTED'],
    schemas: '/v1/capabilities/commands',
  };
}
