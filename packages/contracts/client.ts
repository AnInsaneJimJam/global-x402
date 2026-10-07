import { commandDescriptions, commandSchema, controlSchema, planSchema, receiptSchema } from './index.js';
import type { Command, Plan } from './index.js';

export class ControlClient {
  constructor(readonly origin: string, readonly token: string, readonly fetcher: typeof fetch = fetch) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/') {
      throw new Error('This prototype client supports a configured localhost origin only.');
    }
  }
  private async request(path: string, method = 'GET', body?: unknown, operationId?: string) {
    const response = await this.fetcher(new URL(path, this.origin), {
      method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json',
        ...(operationId ? { 'idempotency-key': operationId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      // Never autonomously pay a 402 or infer failed external effects from HTTP status.
      throw new Error(`CONTROL_HTTP_${response.status}: inspect the existing operation before retrying an effect`);
    }
    return response.json();
  }
  async prepare(command: Command) {
    return planSchema.parse(await this.request('/v1/action-plans', 'POST', commandSchema.parse(command)));
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
}
