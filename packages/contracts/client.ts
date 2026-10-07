import { commandDescriptions, commandSchema, controlSchema, planSchema, purchaseObservationSchema, receiptSchema } from './index.js';
import { DomainError } from './index.js';
import type { Actor, Command, Plan } from './index.js';

export class ControlClient {
  constructor(readonly origin: string, readonly token: string, readonly fetcher: typeof fetch = fetch) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/') {
      throw new Error('This prototype client supports a configured localhost origin only.');
    }
  }
  private async request(path: string, method = 'GET', body?: unknown, operationId?: string, raw?: { type: string; bytes: Uint8Array }) {
    const response = await this.fetcher(new URL(path, this.origin), {
      method, headers: { authorization: `Bearer ${this.token}`, 'content-type': raw?.type ?? 'application/json',
        ...(operationId ? { 'idempotency-key': operationId } : {}) },
      ...(raw ? { body: Buffer.from(raw.bytes) } : body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      type Failure = { code?: string; effectStatus?: string };
      const error: Failure = await response.json().then((json: { error?: Failure }) => json.error ?? {}, () => ({}));
      const code = error.code ?? 'UNKNOWN';
      // A server-confirmed rejection of a new command is a domain error with no effect; anything else stays uncertain.
      if (response.status >= 400 && response.status < 500 && error.effectStatus === 'NOT_STARTED' && response.status !== 402) {
        throw Object.assign(new DomainError(code, response.status), { message: `CONTROL_HTTP_${response.status} ${code}: rejected, no effect` });
      }
      // Never autonomously pay a 402 or infer failed external effects from HTTP status.
      throw new Error(`CONTROL_HTTP_${response.status} ${code}: inspect the existing operation before retrying an effect`);
    }
    return response.json();
  }
  async prepare(command: Command) {
    return planSchema.parse(await this.request('/v1/action-plans', 'POST', commandSchema.parse(command)));
  }
  // Prepare + commit, re-preparing when the order moved underneath the plan (STALE_PLAN is a definite no-effect
  // rejection; the operation identity is version-independent, so retrying the same operationId is safe).
  async commit(command: Command, operationId: string, attempts = 5) {
    for (let attempt = 1; ; attempt++) {
      try { return await this.act(await this.prepare(command), operationId); }
      catch (error) { if (attempt >= attempts || !/ STALE_PLAN:/.test(String(error))) throw error; }
    }
  }
  async act(plan: Plan, operationId: string) {
    const checked = planSchema.parse(plan);
    const route = commandDescriptions[checked.command.command].path;
    const path = 'orderId' in checked.command ? route.replace(':id', encodeURIComponent(checked.command.orderId)) : route;
    return receiptSchema.parse(await this.request(path, 'POST', { planId: checked.id, operationId }, operationId));
  }
  async inspect(orderId: string) { return controlSchema.parse(await this.request(`/v1/orders/${encodeURIComponent(orderId)}/control`)); }
  async operation(operationId: string) {
    return receiptSchema.parse(await this.request(`/v1/operations/${encodeURIComponent(operationId)}`));
  }
  // Track B: filler-side reads and evidence upload.
  async opportunities() {
    return await this.request('/v1/orders') as { orders: { id: string; merchantId: string; sku: string; itemTitle: string | null;
      quantity: number; currency: string; fiatMinor: string; netTokenUnits: string; assetId: string; network: string }[] };
  }
  async assignment(orderId: string) {
    return await this.request(`/v1/orders/${encodeURIComponent(orderId)}/assignment`) as { nonce: string; merchantId: string;
      itemTitle: string | null; quantity: number; currency: string; maximumChargeMinor: string; instructions: string;
      recipient: Record<string, string> };
  }
  async uploadEvidence(orderId: string, bytes: Uint8Array) {
    return await this.request(`/v1/orders/${encodeURIComponent(orderId)}/evidence-uploads`, 'POST', undefined, undefined,
      { type: 'message/rfc822', bytes }) as { evidenceId: string; sha256: string; sizeBytes: number };
  }
  async putRecipient(ref: string, recipient: unknown) {
    return await this.request(`/v1/recipients/${encodeURIComponent(ref)}`, 'PUT', recipient) as { ref: string; stored: boolean };
  }
  async observePurchase(orderId: string, observation: unknown) {
    await this.request(`/v1/orders/${encodeURIComponent(orderId)}/purchase-observations`, 'POST', purchaseObservationSchema.parse(observation));
  }
}

// Adapts the HTTP client to the actor runtime's coordinator port. The actor argument is ignored:
// the server derives the actor from the bearer token, never from the request body.
export function httpCoordinator(client: ControlClient) {
  const plans = new Map<string, Plan>();
  return {
    inspect: (_actor: Actor, orderId: string) => client.inspect(orderId),
    prepare: async (_actor: Actor, command: unknown) => {
      const plan = await client.prepare(commandSchema.parse(command));
      plans.set(plan.id, plan);
      return plan;
    },
    act: (_actor: Actor, planId: string, operationId: string) => {
      const plan = plans.get(planId);
      if (!plan) throw new Error('PLAN_NOT_PREPARED_BY_THIS_CLIENT');
      return client.commit(plan.command, operationId);
    },
    observePurchase: (_actor: Actor, orderId: string, observation: unknown) => client.observePurchase(orderId, observation),
  };
}
