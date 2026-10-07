import type { Order } from '../packages/contracts/index.js';
import { DomainError } from '../packages/contracts/index.js';
import type { Store } from '../packages/procurement/store.js';
import type { CheckoutAdapter } from '../packages/agent-runtime/index.js';

// No HTTP route exposes this fixture authority. This is not a merchant integration.
export async function confirmFixtureFunding(store: Store, orderId: string, claimId: string) {
  await store.transaction(async db => {
    const rows = await db.query<{ data: Order }>('SELECT data FROM gob_orders WHERE id=$1 FOR UPDATE', [orderId]);
    const order = rows.rows[0]?.data;
    if (!order || !order.fillerId || order.claimId !== claimId) throw new DomainError('FIXTURE_FUNDING_BINDING_MISMATCH');
    if (order.funding === 'CONFIRMED') return;
    order.funding = 'CONFIRMED'; order.version++;
    await db.query('UPDATE gob_orders SET data=$2 WHERE id=$1', [orderId, order]);
  });
}

export class ScriptedCheckout implements CheckoutAdapter {
  readonly environment = 'MOCK';
  readonly orders = new Map<string, string>();
  calls = 0;
  constructor(readonly loseResponse = false) {}
  async place(input: { operationId: string }) {
    this.calls++;
    const merchantOrderId = this.orders.get(input.operationId) ?? `fixture-${input.operationId}`;
    this.orders.set(input.operationId, merchantOrderId);
    if (this.loseResponse) throw new Error('Injected connection loss after placement');
    return { merchantOrderId };
  }
  async lookup(operationId: string) {
    const merchantOrderId = this.orders.get(operationId);
    return merchantOrderId ? { state: 'ORDERED' as const, merchantOrderId } : { state: 'UNKNOWN' as const };
  }
}
