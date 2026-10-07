import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/app.js';
import { context, buyer, filler, createOrder } from './helpers.js';

test('HTTP uses the shared handlers, rejects untyped commands, and advertises mocks', async () => {
  const c = await context();
  const app = createApp(c.service, new Map([['fixture-buyer', buyer], ['fixture-filler', filler]]));
  try {
    const cap = await app.inject('/v1/capabilities');
    assert.equal(cap.json().integration.payment.execution, 'MOCK');
    assert.ok(cap.json().blockers.includes('WALLET_AUTH_NOT_IMPLEMENTED'));
    const orderId = await createOrder(c.service);
    const unauthorized = await app.inject(`/v1/orders/${orderId}/control`);
    assert.equal(unauthorized.statusCode, 401);
    const response = await app.inject({ method: 'POST', url: '/v1/action-plans', headers: { authorization: 'Bearer fixture-filler' }, payload: { command: 'claim', orderId } });
    assert.equal(response.statusCode, 200);
    const commit = await app.inject({ method: 'POST', url: `/v1/orders/${orderId}/claims`, headers: { authorization: 'Bearer fixture-filler', 'idempotency-key': 'claim-http' }, payload: { planId: response.json().id, operationId: 'claim-http' } });
    assert.equal(commit.statusCode, 200);
    const view = await app.inject({ url: `/v1/orders/${orderId}/control`, headers: { authorization: 'Bearer fixture-filler' } });
    assert.deepEqual(view.json(), await c.service.inspect(filler, orderId));
    // Track B routes: recipient is buyer-only; assignment and raw .eml upload wait for confirmed funding.
    const asBuyer = { authorization: 'Bearer fixture-buyer' }, asFiller = { authorization: 'Bearer fixture-filler' };
    const recipient = { name: 'Alice Doe', line1: '1 Synthetic Street', city: 'Demo City', postalCode: '000000', country: 'SG' };
    assert.equal((await app.inject({ method: 'PUT', url: '/v1/recipients/synthetic-recipient', headers: asFiller, payload: recipient })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: '/v1/recipients/synthetic-recipient', headers: asBuyer, payload: recipient })).statusCode, 200);
    assert.equal((await app.inject({ url: `/v1/orders/${orderId}/assignment`, headers: asFiller })).json().error.code, 'FUNDING_NOT_CONFIRMED');
    const eml = await app.inject({ method: 'POST', url: `/v1/orders/${orderId}/evidence-uploads`,
      headers: { ...asFiller, 'content-type': 'message/rfc822' }, payload: 'Subject: x\r\n\r\nbody' });
    assert.equal(eml.json().error.code, 'FUNDING_NOT_CONFIRMED');
    const json = await app.inject({ method: 'POST', url: `/v1/orders/${orderId}/evidence-uploads`, headers: asFiller, payload: { a: 1 } });
    assert.equal(json.statusCode, 415);
    const malicious = await app.inject({ method: 'POST', url: '/v1/action-plans', headers: { authorization: 'Bearer fixture-filler' }, payload: { command: 'run_shell', input: 'send money' } });
    assert.equal(malicious.statusCode, 400);
    assert.equal(malicious.json().error.code, 'INVALID_INPUT');
    const missingKey = await app.inject({ method: 'POST', url: `/v1/orders/${orderId}/claims`, headers: { authorization: 'Bearer fixture-filler' }, payload: { planId: response.json().id, operationId: 'claim-http' } });
    assert.equal(missingKey.statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/internal/funding', payload: {} })).statusCode, 404);
  } finally { await app.close(); await c.close(); }
});
