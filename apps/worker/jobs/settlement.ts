import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonical } from '../../../packages/contracts/index.js';
import type { Order, Settlement } from '../../../packages/contracts/index.js';
import { enqueue } from '../../../packages/procurement/outbox.js';
import type { Store } from '../../../packages/procurement/store.js';
import { escrowDeadlines } from '../../../packages/settlement/index.js';
import type { EscrowObservation, EscrowTerms, SettlementAdapter } from '../../../packages/settlement/index.js';
import type { JobHandlers } from './index.js';

type Deps = { adapter: SettlementAdapter; agentIdentifier: string; now?: () => Date; pollMs?: number };
const TERMINAL = new Set(['PAID', 'REFUNDED']);
// Masumi on-chain state → application settlement state. Unknown states keep the last value.
const SETTLEMENT: Record<string, Settlement['state']> = {
  ResultSubmitted: 'DISPUTE_WINDOW', WithdrawAuthorized: 'SETTLEMENT_PENDING', Withdrawn: 'PAID',
  RefundRequested: 'REFUND_PENDING', RefundAuthorized: 'REFUND_PENDING', RefundWithdrawn: 'REFUNDED', Disputed: 'DISPUTED',
};
const LOCKED = new Set(['FundsLocked', 'ResultSubmitted', 'RefundRequested', 'Disputed', 'WithdrawAuthorized', 'RefundAuthorized',
  'Withdrawn', 'RefundWithdrawn', 'DisputedWithdrawn']);
// Masumi unit = policyId + assetNameHex; the app writes assetId as "policyId.assetNameHex".
export const masumiUnit = (assetId: string) => assetId.replace('.', '');

async function locked(store: Store, orderId: string, fn: (order: Order) => boolean | void) {
  await store.transaction(async db => {
    const order = (await db.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0]?.data;
    if (!order || fn(order) === false) return;
    order.version++;
    await db.query('UPDATE gob_orders SET data=$2 WHERE id=$1', [order.id, order]);
  });
}
const load = async (store: Store, orderId: string) =>
  (await store.pool.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1', [orderId])).rows[0]?.data;
const observeAgain = (store: Store, orderId: string, deps: Deps) => enqueue(store.pool, { kind: 'observe_escrow', orderId,
  // Scheduling uses the real clock (the DB compares with now()); deps.now only sets business deadlines.
  dedupeKey: `observe:${orderId}:${randomUUID()}`, payload: {}, notBefore: new Date(Date.now() + (deps.pollMs ?? 30_000)) });

// External calls happen outside DB transactions; results are written under the order lock.
export function settlementJobs(deps: Deps): JobHandlers {
  return {
    async create_escrow_terms(job, store) {
      const order = await load(store, job.orderId);
      if (!order?.claimId || order.escrow) return;
      const terms = await deps.adapter.createEscrowTerms({ termsHash: order.termsHash, agentIdentifier: deps.agentIdentifier,
        amounts: [{ amount: order.intent.netTokenUnits, unit: masumiUnit(order.intent.assetId) }],
        deadlines: escrowDeadlines(deps.now?.() ?? new Date()), metadata: `gob:${order.id}` });
      await locked(store, job.orderId, current => {
        if (current.escrow || current.claimId !== order.claimId) return false;
        current.escrow = { escrowId: terms.escrowId, sellerAgentId: deps.agentIdentifier, buyerWalletRef: 'masumi-purchasing-wallet',
          assetId: current.intent.assetId, grossBaseUnits: current.intent.netTokenUnits, deadlines: terms.deadlines,
          nativeState: 'PAYMENT_REQUESTED', lastObservedAt: new Date().toISOString(), execution: deps.adapter.execution, terms, txs: [] };
      });
    },
    async fund_escrow(job, store) {
      const order = await load(store, job.orderId);
      if (!order?.escrow?.terms || order.funding !== 'PENDING') return;
      await deps.adapter.fund(order.escrow.terms as EscrowTerms);
      await observeAgain(store, job.orderId, { ...deps, pollMs: 0 });
    },
    async observe_escrow(job, store) {
      const order = await load(store, job.orderId);
      if (!order?.escrow) return;
      const seen: EscrowObservation = await deps.adapter.observe(order.escrow.escrowId);
      let terminal = false;
      await locked(store, job.orderId, current => {
        const escrow = current.escrow!;
        const state = seen.paymentState ?? seen.purchaseState;
        // canonical(): jsonb reorders keys, so plain JSON.stringify would report a change on every poll.
        const before = canonical([current.funding, current.settlement, escrow.nativeState, escrow.txs]);
        escrow.lastObservedAt = seen.observedAt;
        if (state) escrow.nativeState = state;
        const txs = new Map((escrow.txs ?? []).map(tx => [tx.txHash, tx]));
        for (const tx of seen.txs) txs.set(tx.txHash, tx);
        escrow.txs = [...txs.values()];
        if (state && LOCKED.has(state) && current.funding !== 'CONFIRMED') {
          current.funding = 'CONFIRMED';
          current.fundedAt = seen.observedAt; // assignment is revealed only after this, so it bounds order time
        }
        if (state === 'FundsOrDatumInvalid') current.funding = 'RECONCILING';
        const next = state ? SETTLEMENT[state] : undefined;
        if (next) current.settlement = { state: next, txs: escrow.txs };
        terminal = TERMINAL.has(current.settlement?.state ?? '') || state === 'DisputedWithdrawn';
        return before !== canonical([current.funding, current.settlement, escrow.nativeState, escrow.txs]);
      });
      if (!terminal) await observeAgain(store, job.orderId, deps);
    },
    async submit_result(job, store) {
      const { resultHash } = z.object({ resultHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(job.payload);
      const order = await load(store, job.orderId);
      if (!order?.escrow || order.verification?.resultHash !== resultHash || order.verification.verdict !== 'PASS') return;
      await deps.adapter.submitResult(order.escrow.escrowId, resultHash);
      await locked(store, job.orderId, current => {
        if (current.settlement && current.settlement.state !== 'NONE') return false;
        current.settlement = { state: 'RESULT_PENDING', txs: current.escrow?.txs ?? [] };
      });
      await observeAgain(store, job.orderId, { ...deps, pollMs: 0 });
    },
    async request_refund(job, store) {
      const order = await load(store, job.orderId);
      if (!order?.escrow) return;
      await deps.adapter.requestRefund(order.escrow.escrowId);
      await observeAgain(store, job.orderId, { ...deps, pollMs: 0 });
    },
    async authorize_refund(job, store) {
      const order = await load(store, job.orderId);
      if (!order?.escrow) return;
      await deps.adapter.authorizeRefund(order.escrow.escrowId);
      await observeAgain(store, job.orderId, { ...deps, pollMs: 0 });
    },
  };
}
