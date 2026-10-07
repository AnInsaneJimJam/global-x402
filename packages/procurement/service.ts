import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { commandSchema, controlSchema, hash, DomainError } from '../contracts/index.js';
import type { Actor, Command, Order, Plan, Receipt } from '../contracts/index.js';
import { handlers } from './commands/index.js';
import { integrationFor, verificationView } from './evidence.js';
import { settlementView } from './settlement-view.js';
import { Store } from './store.js';

type Clock = () => Date;
type DataRow<T> = { data: T };
function fail(code: string, status = 409): never { throw new DomainError(code, status); }
function visible(actor: Actor, order: Order) {
  return actor.role === 'BUYER' ? actor.id === order.buyerId : actor.id === order.fillerId;
}

// One plain sentence for the current state; agents and the dashboard read the same text.
function summarize(order: Order, uncertain: boolean, placed: boolean, verification: string) {
  const settled = order.settlement?.state;
  if (settled === 'PAID') return 'Paid out to the filler. Order complete.';
  if (settled === 'REFUNDED') return 'Escrow refunded to the buyer.';
  if (settled === 'DISPUTED') return 'Disputed in escrow; waiting for resolution.';
  if (settled === 'REFUND_PENDING') return 'Refund requested; waiting for the filler or the escrow deadline.';
  if (settled === 'DISPUTE_WINDOW' || settled === 'SETTLEMENT_PENDING') return 'Placement verified and the result is on chain. Escrow pays the filler after unlock unless the buyer disputes.';
  if (settled === 'RESULT_PENDING') return 'Placement verified; submitting the result to escrow.';
  if (uncertain) return 'Checkout outcome is uncertain; reconcile it before any new purchase.';
  if (verification === 'PENDING') return 'Confirmation email received; verifying the merchant signature.';
  if (verification === 'FAIL' || verification === 'INCONCLUSIVE') return 'Proof did not pass automatically; the buyer needs to review it.';
  if (verification === 'MANUAL_REJECTED') return 'Buyer rejected the proof; refund path applies.';
  if (placed) return 'Order placed at the merchant; waiting for the confirmation email.';
  if (order.funding === 'CONFIRMED') return 'Escrow funded. The filler can now place the order.';
  if (order.funding === 'PENDING') return 'Funding submitted; waiting for the lock on chain.';
  if (order.funding === 'RECONCILING') return 'Funding needs reconciliation before anything else happens.';
  if (order.escrow) return 'Escrow terms ready; waiting for the buyer to fund.';
  if (order.claimId) return "Claimed; waiting for escrow terms from the filler's node.";
  return 'Open for fillers.';
}

export class Procurement {
  constructor(readonly store: Store, readonly clock: Clock = () => new Date()) {}

  private async order(db: pg.PoolClient, orderId: string, lock = false): Promise<Order> {
    const row = await db.query<DataRow<Order>>(
      `SELECT data FROM gob_orders WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [orderId]);
    return row.rows[0]?.data ?? fail('NOT_FOUND', 404);
  }

  async prepare(actor: Actor, input: unknown): Promise<Plan> {
    const command = commandSchema.parse(input);
    return this.store.transaction(async db => {
      const order = 'orderId' in command ? await this.order(db, command.orderId) : null;
      handlers[command.command].eligible(actor, order, command);
      const plan: Plan = {
        id: randomUUID(), actor, command,
        effectHash: hash({ actor, command, termsHash: order?.termsHash ?? null, claimId: order?.claimId ?? null }),
        controlVersion: order?.version ?? null,
        expiresAt: new Date(this.clock().getTime() + 60_000).toISOString(),
      };
      await db.query('INSERT INTO gob_plans(id,actor_id,data) VALUES ($1,$2,$3)', [plan.id, actor.id, plan]);
      return plan;
    });
  }

  async act(actor: Actor, planId: string, operationId: string,
    route?: { command: Command['command']; orderId?: string }, transportKey?: string): Promise<Receipt> {
    return this.store.transaction(async db => {
      // Business-operation serialization precedes expiry checks, including after a restart.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${actor.id}:${operationId}`]);
      const planRow = await db.query<DataRow<Plan>>('SELECT data FROM gob_plans WHERE id=$1 AND actor_id=$2', [planId, actor.id]);
      const plan = planRow.rows[0]?.data ?? fail('NOT_FOUND', 404);
      if (plan.actor.role !== actor.role) fail('ROLE_FORBIDDEN', 403);
      if (route && (plan.command.command !== route.command ||
        (route.orderId && (!('orderId' in plan.command) || plan.command.orderId !== route.orderId)))) fail('PLAN_ROUTE_MISMATCH');
      if (transportKey) {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`key:${actor.id}:${transportKey}`]);
        const keys = await db.query<{ operation_id: string; effect_hash: string }>(
          'SELECT operation_id,effect_hash FROM gob_transport_keys WHERE actor_id=$1 AND transport_key=$2', [actor.id, transportKey]);
        const oldKey = keys.rows[0];
        if (oldKey && (oldKey.operation_id !== operationId || oldKey.effect_hash !== plan.effectHash)) fail('OPERATION_CONFLICT');
        if (!oldKey) await db.query('INSERT INTO gob_transport_keys(actor_id,transport_key,operation_id,effect_hash) VALUES ($1,$2,$3,$4)',
          [actor.id, transportKey, operationId, plan.effectHash]);
      }
      const previous = await db.query<DataRow<Receipt>>('SELECT data FROM gob_operations WHERE actor_id=$1 AND operation_id=$2', [actor.id, operationId]);
      if (previous.rows[0]) {
        if (previous.rows[0].data.effectHash !== plan.effectHash) fail('OPERATION_CONFLICT');
        return previous.rows[0].data;
      }
      if (this.clock().getTime() >= Date.parse(plan.expiresAt)) fail('PLAN_EXPIRED');
      const command = plan.command;
      let order: Order;
      const handler = handlers[command.command];
      if (command.command === 'create_intent') {
        handler.eligible(actor, null, command);
        order = await handler.apply(db, actor, null, command);
      } else {
        order = await this.order(db, command.orderId, true);
        if (plan.controlVersion !== order.version) fail('STALE_PLAN');
        handler.eligible(actor, order, command);
        order = await handler.apply(db, actor, order, command);
        order.version++;
        await db.query('UPDATE gob_orders SET data=$2 WHERE id=$1', [order.id, order]);
      }
      const receipt: Receipt = { operationId, actorId: actor.id, command: command.command, effectHash: plan.effectHash,
        status: 'SUCCEEDED', orderId: order.id, createdAt: this.clock().toISOString() };
      await db.query('INSERT INTO gob_operations(actor_id,operation_id,effect_hash,data) VALUES ($1,$2,$3,$4)',
        [actor.id, operationId, plan.effectHash, receipt]);
      return receipt;
    });
  }

  async observePurchase(actor: Actor, orderId: string,
    observation: { purchaseOperationId: string; state: 'SUBMITTING' | 'UNKNOWN' | 'ORDERED' | 'FAILED_CONFIRMED'; merchantOrderId?: string | undefined }) {
    return this.store.transaction(async db => {
      const order = await this.order(db, orderId, true);
      if (actor.role !== 'FILLER' || order.fillerId !== actor.id) fail('NOT_FOUND', 404);
      const attempt = order.purchase;
      if (!attempt || attempt.operationId !== observation.purchaseOperationId) fail('PURCHASE_REFERENCE_MISMATCH');
      if (observation.state === 'FAILED_CONFIRMED') fail('INDEPENDENT_RECONCILIATION_REQUIRED');
      if (attempt.state === 'ORDERED') {
        if (observation.state !== 'ORDERED' || observation.merchantOrderId !== attempt.merchantOrderId) fail('PURCHASE_OUTCOME_CONFLICT');
        return;
      }
      if (attempt.state === 'UNKNOWN' && observation.state === 'SUBMITTING') fail('RECONCILIATION_REQUIRED');
      if (observation.state === 'ORDERED' && !observation.merchantOrderId) fail('MERCHANT_ORDER_REQUIRED', 422);
      attempt.state = observation.state; attempt.merchantOrderId = observation.merchantOrderId ?? null;
      order.version++;
      await db.query('UPDATE gob_orders SET data=$2 WHERE id=$1', [orderId, order]);
    });
  }

  async inspect(actor: Actor, orderId: string) {
    return this.store.transaction(async db => {
      const order = await this.order(db, orderId);
      if (!visible(actor, order)) fail('NOT_FOUND', 404);
      const uncertain = order.purchase && ['PREPARED', 'SUBMITTING', 'UNKNOWN'].includes(order.purchase.state);
      const placed = order.purchase?.state === 'ORDERED';
      const verification = verificationView(order, actor);
      const settlement = settlementView(order, actor);
      return controlSchema.parse({
        schemaVersion: '0.2.0', scope: { kind: 'order', id: order.id }, viewer: actor,
        controlVersion: order.version, generatedAt: this.clock().toISOString(), integration: integrationFor(order),
        termsHash: order.termsHash, claimId: order.claimId,
        summary: summarize(order, Boolean(uncertain), placed, verification.outcome),
        outcome: { placement: placed ? 'ACTOR_REPORTED' : 'UNKNOWN', verification: verification.outcome, settlement: settlement.settlement, goal: 'OPEN' },
        facts: [
          { key: 'funding', state: order.funding === 'CONFIRMED' ? 'OBSERVED' : 'NOT_OBSERVED', sourceType: settlement.fundingSource, value: order.funding },
          { key: 'merchantPurchase', state: placed ? 'OBSERVED' : uncertain ? 'UNKNOWN' : 'NOT_OBSERVED', sourceType: 'ACTOR_REPORT', value: order.purchase },
          ...settlement.facts,
          ...verification.facts,
        ],
        exposure: order.funding === 'CONFIRMED' ? [{ owner: order.buyerId, assetId: order.intent.assetId, units: order.intent.netTokenUnits, kind: order.escrow?.execution === 'LIVE' ? 'ESCROW_LOCKED' : 'FIXTURE_LOCKED' }] : [],
        obligations: [...(uncertain ? [{ type: 'RECONCILE_PURCHASE', owner: order.fillerId, operationId: order.purchase?.operationId }] : placed ?
          (order.evidence ? verification.obligations : [{ type: 'SUBMIT_EVIDENCE', owner: order.fillerId }]) : []),
          ...settlement.obligations],
        actions: [
          { command: 'register_purchase', status: !order.purchase && order.funding === 'CONFIRMED' && actor.role === 'FILLER' ? 'AVAILABLE' : 'BLOCKED',
            reasonCodes: order.purchase ? [placed ? 'PURCHASE_ALREADY_PLACED' : 'UNRESOLVED_PURCHASE'] : order.funding !== 'CONFIRMED' ? ['FUNDING_NOT_CONFIRMED'] : actor.role !== 'FILLER' ? ['ROLE_FORBIDDEN'] : [], requiredAuthority: 'ACTOR_LOCAL_CHECKOUT_GRANT' },
          ...settlement.actions,
          verification.action,
        ],
      });
    });
  }

  async operation(actor: Actor, operationId: string): Promise<Receipt> {
    const row = await this.store.pool.query<DataRow<Receipt>>('SELECT data FROM gob_operations WHERE actor_id=$1 AND operation_id=$2', [actor.id, operationId]);
    return row.rows[0]?.data ?? fail('NOT_FOUND', 404);
  }

  async work(actor: Actor, after = '') {
    const rows = await this.store.pool.query<{ id: string; data: Order }>(
      actor.role === 'BUYER' ? 'SELECT id,data FROM gob_orders WHERE buyer_id=$1 AND id>$2 ORDER BY id LIMIT 101' :
        "SELECT id,data FROM gob_orders WHERE data->>'fillerId'=$1 AND id>$2 ORDER BY id LIMIT 101", [actor.id, after]);
    const page = rows.rows.slice(0, 100);
    return { orders: page.map(row => row.id), scope: 'LOCAL_CONTROL_CONTRACT_ONLY', limit: 100,
      items: page.map(({ data: o }) => ({ id: o.id, itemTitle: o.intent.itemTitle ?? o.intent.sku, currency: o.intent.currency,
        fiatMinor: o.intent.fiatMinor, netTokenUnits: o.intent.netTokenUnits, settlement: o.settlement?.state ?? 'NONE' })),
      overflow: rows.rows.length > 100, nextAfter: rows.rows.length > 100 ? page.at(-1)?.id : null };
  }

  async opportunities(after = '') {
    const rows = await this.store.pool.query<DataRow<Order>>(
      "SELECT data FROM gob_orders WHERE data->>'fillerId' IS NULL AND id>$1 ORDER BY id LIMIT 101", [after]);
    const page = rows.rows.slice(0, 100);
    return { orders: page.map(({ data: order }) => ({ id: order.id, merchantId: order.intent.merchantId,
      sku: order.intent.sku, itemTitle: order.intent.itemTitle ?? null, itemUrl: order.intent.itemUrl ?? null, quantity: order.intent.quantity,
      currency: order.intent.currency, fiatMinor: order.intent.fiatMinor,
      netTokenUnits: order.intent.netTokenUnits, assetId: order.intent.assetId, network: order.intent.network,
      status: 'AWAITING_FUNDING', integration: integrationFor(order) })), overflow: rows.rows.length > 100,
      nextAfter: rows.rows.length > 100 ? page.at(-1)?.data.id : null };
  }
}
