import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { commandSchema, controlSchema, hash, DomainError, integration } from '../contracts/index.js';
import type { Actor, Command, Order, Plan, Receipt } from '../contracts/index.js';
import { Store } from './store.js';

type Clock = () => Date;
type DataRow<T> = { data: T };
function fail(code: string, status = 409): never { throw new DomainError(code, status); }
function visible(actor: Actor, order: Order) {
  return actor.role === 'BUYER' ? actor.id === order.buyerId : actor.id === order.fillerId;
}

export class Procurement {
  constructor(readonly store: Store, readonly clock: Clock = () => new Date()) {}

  private async order(db: pg.PoolClient, orderId: string, lock = false): Promise<Order> {
    const row = await db.query<DataRow<Order>>(
      `SELECT data FROM gob_orders WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [orderId]);
    return row.rows[0]?.data ?? fail('NOT_FOUND', 404);
  }

  private eligible(actor: Actor, command: Command, order: Order | null) {
    if (command.command === 'create_intent') {
      if (actor.role !== 'BUYER') fail('ROLE_FORBIDDEN', 403);
      if (BigInt(command.input.fiatMinor) <= 0n || BigInt(command.input.netTokenUnits) <= 0n) fail('INVALID_AMOUNT', 422);
      return;
    }
    if (!order) fail('NOT_FOUND', 404);
    if (command.command === 'claim') {
      if (actor.role !== 'FILLER') fail('ROLE_FORBIDDEN', 403);
      if (order.fillerId) fail('ALREADY_CLAIMED');
      return;
    }
    if (actor.role !== 'FILLER' || order.fillerId !== actor.id) fail('NOT_FOUND', 404);
    if (order.funding !== 'CONFIRMED') fail('FUNDING_NOT_CONFIRMED');
    if (command.command === 'register_purchase') {
      if (order.purchase) fail(order.purchase.state === 'ORDERED' ? 'PURCHASE_ALREADY_PLACED' : 'UNRESOLVED_PURCHASE');
    } else {
      if (order.purchase?.state !== 'ORDERED' || order.purchase.operationId !== command.purchaseOperationId ||
        order.purchase.merchantOrderId !== command.merchantOrderId) fail('PURCHASE_REFERENCE_MISMATCH');
    }
  }

  async prepare(actor: Actor, input: unknown): Promise<Plan> {
    const command = commandSchema.parse(input);
    return this.store.transaction(async db => {
      const order = 'orderId' in command ? await this.order(db, command.orderId) : null;
      this.eligible(actor, command, order);
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
      if (command.command === 'create_intent') {
        this.eligible(actor, command, null);
        // Serializes client-order uniqueness independently of transport operation IDs.
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`intent:${actor.id}:${command.input.clientOrderId}`]);
        const existing = await db.query('SELECT id FROM gob_orders WHERE buyer_id=$1 AND client_order_id=$2', [actor.id, command.input.clientOrderId]);
        if (existing.rowCount) fail('CLIENT_ORDER_CONFLICT');
        order = { id: randomUUID(), buyerId: actor.id, intent: command.input, termsHash: hash(command.input),
          version: 1, fillerId: null, claimId: null, funding: 'NOT_OBSERVED', purchase: null, evidence: null };
        await db.query('INSERT INTO gob_orders(id,buyer_id,client_order_id,data) VALUES ($1,$2,$3,$4)',
          [order.id, actor.id, command.input.clientOrderId, order]);
      } else {
        order = await this.order(db, command.orderId, true);
        if (plan.controlVersion !== order.version) fail('STALE_PLAN');
        this.eligible(actor, command, order);
        if (command.command === 'claim') {
          order.fillerId = actor.id; order.claimId = randomUUID();
          order.termsHash = hash({ intent: order.intent, buyerId: order.buyerId, fillerId: order.fillerId, claimId: order.claimId });
        } else if (command.command === 'register_purchase') {
          const binding = await db.query('INSERT INTO gob_purchase_bindings(actor_id,purchase_operation_id,order_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING order_id',
            [actor.id, command.purchaseOperationId, order.id]);
          if (!binding.rowCount) fail('PURCHASE_OPERATION_CONFLICT');
          order.purchase = { operationId: command.purchaseOperationId, state: 'PREPARED', merchantOrderId: null };
        } else {
          // Global evidence uniqueness is a DB invariant, including simultaneous submissions.
          const binding = await db.query<{ order_id: string }>(
            'INSERT INTO gob_evidence_bindings(merchant_id,merchant_order_id,order_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING order_id',
            [order.intent.merchantId, command.merchantOrderId, order.id]);
          if (!binding.rowCount) {
            const prior = await db.query<{ order_id: string }>('SELECT order_id FROM gob_evidence_bindings WHERE merchant_id=$1 AND merchant_order_id=$2', [order.intent.merchantId, command.merchantOrderId]);
            if (prior.rows[0]?.order_id !== order.id) fail('EVIDENCE_REPLAY');
          }
          order.evidence = command.merchantOrderId;
        }
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
      return controlSchema.parse({
        schemaVersion: '0.1.0', scope: { kind: 'order', id: order.id }, viewer: actor,
        controlVersion: order.version, generatedAt: this.clock().toISOString(), integration,
        termsHash: order.termsHash, claimId: order.claimId,
        summary: uncertain ? 'Reconcile the registered purchase; new checkout is blocked.' : placed ?
          'Placement is actor-reported. Independent verification and settlement are not implemented.' : 'Local control-contract fixture; no live spending capability.',
        outcome: { placement: placed ? 'ACTOR_REPORTED' : 'UNKNOWN', verification: 'NOT_IMPLEMENTED', settlement: 'NOT_IMPLEMENTED', goal: 'OPEN' },
        facts: [
          { key: 'funding', state: order.funding === 'CONFIRMED' ? 'OBSERVED' : 'NOT_OBSERVED', sourceType: 'MOCK_CHAIN', value: order.funding },
          { key: 'merchantPurchase', state: placed ? 'OBSERVED' : uncertain ? 'UNKNOWN' : 'NOT_OBSERVED', sourceType: 'ACTOR_REPORT', value: order.purchase },
        ],
        exposure: order.funding === 'CONFIRMED' ? [{ owner: order.buyerId, assetId: order.intent.assetId, units: order.intent.netTokenUnits, kind: 'FIXTURE_LOCKED' }] : [],
        obligations: uncertain ? [{ type: 'RECONCILE_PURCHASE', owner: order.fillerId, operationId: order.purchase?.operationId }] : placed ?
          [{ type: order.evidence ? 'VERIFY_EVIDENCE' : 'SUBMIT_EVIDENCE', owner: order.evidence ? 'VERIFIER_NOT_IMPLEMENTED' : order.fillerId }] : [],
        actions: [
          { command: 'register_purchase', status: !order.purchase && order.funding === 'CONFIRMED' && actor.role === 'FILLER' ? 'AVAILABLE' : 'BLOCKED',
            reasonCodes: order.purchase ? [placed ? 'PURCHASE_ALREADY_PLACED' : 'UNRESOLVED_PURCHASE'] : order.funding !== 'CONFIRMED' ? ['FUNDING_NOT_CONFIRMED'] : actor.role !== 'FILLER' ? ['ROLE_FORBIDDEN'] : [], requiredAuthority: 'ACTOR_LOCAL_CHECKOUT_GRANT' },
          { command: 'fund_escrow', status: 'BLOCKED', reasonCodes: ['LIVE_FUNDING_UNVALIDATED'] },
        ],
      });
    });
  }

  async operation(actor: Actor, operationId: string): Promise<Receipt> {
    const row = await this.store.pool.query<DataRow<Receipt>>('SELECT data FROM gob_operations WHERE actor_id=$1 AND operation_id=$2', [actor.id, operationId]);
    return row.rows[0]?.data ?? fail('NOT_FOUND', 404);
  }

  async work(actor: Actor, after = '') {
    const rows = await this.store.pool.query<{ id: string }>(
      actor.role === 'BUYER' ? 'SELECT id FROM gob_orders WHERE buyer_id=$1 AND id>$2 ORDER BY id LIMIT 101' :
        "SELECT id FROM gob_orders WHERE data->>'fillerId'=$1 AND id>$2 ORDER BY id LIMIT 101", [actor.id, after]);
    const page = rows.rows.slice(0, 100);
    return { orders: page.map(row => row.id), scope: 'LOCAL_CONTROL_CONTRACT_ONLY', limit: 100,
      overflow: rows.rows.length > 100, nextAfter: rows.rows.length > 100 ? page.at(-1)?.id : null };
  }

  async opportunities(after = '') {
    const rows = await this.store.pool.query<DataRow<Order>>(
      "SELECT data FROM gob_orders WHERE data->>'fillerId' IS NULL AND id>$1 ORDER BY id LIMIT 101", [after]);
    const page = rows.rows.slice(0, 100);
    return { orders: page.map(({ data: order }) => ({ id: order.id, merchantId: order.intent.merchantId,
      sku: order.intent.sku, quantity: order.intent.quantity, fiatMinor: order.intent.fiatMinor,
      netTokenUnits: order.intent.netTokenUnits, assetId: order.intent.assetId, network: order.intent.network,
      status: 'AWAITING_FUNDING', integration })), overflow: rows.rows.length > 100,
      nextAfter: rows.rows.length > 100 ? page.at(-1)?.data.id : null };
  }
}
