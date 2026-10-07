import test from 'node:test';
import assert from 'node:assert/strict';
import { context, createOrder } from './helpers.js';
import { enqueue } from '../packages/procurement/outbox.js';
import { runOne } from '../apps/worker/worker.js';

test('transactional outbox leases, dispatches and deduplicates a job', async () => {
  const c = await context();
  try {
    await c.store.migrate();
    const orderId = await createOrder(c.service);
    await c.store.transaction(async db => {
      await enqueue(db, { kind: 'test_dummy', orderId, dedupeKey: `dummy:${orderId}`, payload: { orderId } });
      await enqueue(db, { kind: 'test_dummy', orderId, dedupeKey: `dummy:${orderId}`, payload: { orderId } });
    });
    const seen: string[] = [];
    assert.equal(await runOne(c.store, { test_dummy: async job => { seen.push(job.orderId); } }), true);
    assert.deepEqual(seen, [orderId]);
    assert.equal(await runOne(c.store, { test_dummy: async () => { throw new Error('unexpected'); } }), false);
    const remaining = await c.store.pool.query('SELECT id FROM gob_outbox');
    assert.equal(remaining.rowCount, 0);
  } finally { await c.close(); }
});

test('failed job is released for a delayed retry', async () => {
  const c = await context();
  try {
    const orderId = await createOrder(c.service);
    await c.store.transaction(db => enqueue(db, { kind: 'test_retry', orderId,
      dedupeKey: `retry:${orderId}`, payload: {} }));
    assert.equal(await runOne(c.store, { test_retry: async () => { throw new Error('sensitive detail'); } }), true);
    const queued = await c.store.pool.query<{ attempts: number; last_error: string; delayed: boolean; lease_until: Date | null }>(
      'SELECT attempts,last_error,lease_until,next_at>now() AS delayed FROM gob_outbox');
    assert.equal(queued.rows[0]?.attempts, 1);
    assert.equal(queued.rows[0]?.last_error, 'Error');
    assert.equal(queued.rows[0]?.lease_until, null);
    assert.equal(queued.rows[0]?.delayed, true);
    await c.store.pool.query('UPDATE gob_outbox SET next_at=now()');
    assert.equal(await runOne(c.store, { test_retry: async () => {} }), true);
    assert.equal((await c.store.pool.query('SELECT id FROM gob_outbox')).rowCount, 0);
  } finally { await c.close(); }
});
