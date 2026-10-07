import { DomainError, id } from '../contracts/index.js';
import type { Actor, Order } from '../contracts/index.js';
import type { Store } from './store.js';

// Exact escrow terms for the order's buyer, so the buyer's own agent can lock funds with its own key.
export async function escrowTerms(store: Store, actor: Actor, orderId: string) {
  const order = (await store.pool.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1', [id.parse(orderId)])).rows[0]?.data;
  if (!order || actor.role !== 'BUYER' || actor.id !== order.buyerId) throw new DomainError('NOT_FOUND', 404);
  if (!order.escrow?.terms) throw new DomainError('ESCROW_TERMS_NOT_READY');
  return { orderId: order.id, grossBaseUnits: order.escrow.grossBaseUnits, assetId: order.escrow.assetId, terms: order.escrow.terms };
}

// Settlement slice of the control view: funding source, escrow deadlines/txs, and the escrow actions.
export function settlementView(order: Order, actor: Actor) {
  const escrow = order.escrow ?? null;
  const live = escrow?.execution === 'LIVE';
  const state = order.settlement?.state ?? 'NONE';
  const isBuyer = actor.role === 'BUYER' && actor.id === order.buyerId;
  const isFiller = actor.role === 'FILLER' && actor.id === order.fillerId;
  const fundable = !!escrow?.terms && order.funding === 'NOT_OBSERVED';
  const refundable = order.funding === 'CONFIRMED' && ['NONE', 'RESULT_PENDING', 'DISPUTE_WINDOW'].includes(state);
  const action = (command: 'fund_escrow' | 'request_refund' | 'authorize_refund', ok: boolean, owner: boolean, why: string) =>
    ({ command, status: ok && owner ? 'AVAILABLE' as const : 'BLOCKED' as const, reasonCodes: ok ? (owner ? [] : ['ROLE_FORBIDDEN']) : [why] });
  return {
    fundingSource: live ? 'CHAIN_OBSERVER' as const : 'MOCK_CHAIN' as const,
    settlement: order.settlement?.state ?? 'NONE',
    facts: escrow ? [
      { key: 'escrow' as const, state: 'OBSERVED' as const, sourceType: live ? 'MASUMI_NODE' as const : 'MOCK_CHAIN' as const,
        value: { escrowId: `${escrow.escrowId.slice(0, 16)}…`, nativeState: escrow.nativeState, deadlines: escrow.deadlines,
          grossBaseUnits: escrow.grossBaseUnits, assetId: escrow.assetId, txs: escrow.txs ?? [], lastObservedAt: escrow.lastObservedAt } },
      ...(order.settlement ? [{ key: 'settlement' as const, state: 'OBSERVED' as const,
        sourceType: live ? 'CHAIN_OBSERVER' as const : 'MOCK_CHAIN' as const, value: order.settlement }] : []),
    ] : [],
    obligations: [
      ...(fundable ? [{ type: 'FUND_ESCROW' as const, owner: order.buyerId }] : []),
      ...(state === 'DISPUTE_WINDOW' ? [{ type: 'MONITOR_DISPUTE_WINDOW' as const, owner: order.buyerId }] : []),
      ...(state === 'REFUND_PENDING' ? [{ type: 'AUTHORIZE_REFUND' as const, owner: order.fillerId }] : []),
    ],
    actions: [
      action('fund_escrow', fundable, isBuyer, escrow ? 'FUNDING_ALREADY_STARTED' : 'ESCROW_TERMS_NOT_READY'),
      action('request_refund', refundable, isBuyer, 'NOT_REFUNDABLE_NOW'),
      action('authorize_refund', state === 'REFUND_PENDING' || state === 'DISPUTED', isFiller, 'NO_REFUND_REQUESTED'),
    ],
  };
}
