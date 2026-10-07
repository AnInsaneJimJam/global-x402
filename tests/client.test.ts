import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControlClient } from '../packages/contracts/client.js';
import { createApp } from '../apps/api/app.js';
import { context, buyer, intent } from './helpers.js';

test('reference client drives named routes using generated input/output validators', async () => {
  const c = await context(); const app = createApp(c.service, new Map([['fixture-buyer', buyer]]));
  try {
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const response = await app.inject({ method: (init?.method ?? 'GET') as 'GET' | 'POST', url: url.pathname,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        ...(typeof init?.body === 'string' ? { payload: JSON.parse(init.body) } : {}) });
      return new Response(response.body, { status: response.statusCode });
    };
    const client = new ControlClient('http://localhost:3000', 'fixture-buyer', transport);
    const plan = await client.prepare({ command: 'create_intent', input: intent });
    const receipt = await client.act(plan, 'client-create');
    assert.deepEqual(await client.operation('client-create'), receipt);
    assert.deepEqual(await client.act(plan, 'client-create'), receipt);
    const view = await client.inspect(receipt.orderId);
    assert.equal(view.integration.payment.execution, 'MOCK');
    assert.ok(Buffer.byteLength(JSON.stringify(view)) < 8192);
  } finally { await app.close(); await c.close(); }
});

test('unexpected 402 never triggers automatic payment or retry', async () => {
  let calls = 0;
  const client = new ControlClient('http://localhost:3000', 'fixture-token', async () => {
    calls++; return new Response('{}', { status: 402 });
  });
  await assert.rejects(client.inspect('order'), /CONTROL_HTTP_402/);
  assert.equal(calls, 1);
  assert.throws(() => new ControlClient('https://untrusted.example', 'fixture-token'), /localhost/);
});
