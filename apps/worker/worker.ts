import type { Store } from '../../packages/procurement/store.js';
import type { OutboxJob } from '../../packages/procurement/outbox.js';
import { handlers as productionHandlers } from './jobs/index.js';
import type { JobHandlers } from './jobs/index.js';

type Row = { id: string; kind: string; order_id: string; dedupe_key: string;
  payload: unknown; attempts: number };

// Claim and commit before running a handler; a crash leaves the lease to expire.
export async function runOne(store: Store, handlers: JobHandlers = productionHandlers): Promise<boolean> {
  const claimed = await store.transaction(async db => {
    const rows = await db.query<Row>(`SELECT id,kind,order_id,dedupe_key,payload,attempts FROM gob_outbox
      WHERE next_at <= now() AND (lease_until IS NULL OR lease_until <= now())
      ORDER BY next_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const row = rows.rows[0];
    if (!row) return null;
    const attempts = row.attempts + 1;
    await db.query("UPDATE gob_outbox SET attempts=$2,lease_until=now()+interval '5 minutes' WHERE id=$1", [row.id, attempts]);
    return { id: row.id, kind: row.kind, orderId: row.order_id, dedupeKey: row.dedupe_key,
      payload: row.payload, attempts } satisfies OutboxJob;
  });
  if (!claimed) return false;
  try {
    const handler = handlers[claimed.kind];
    if (!handler) throw new Error('UNKNOWN_JOB_KIND');
    await handler(claimed, store);
    await store.pool.query('DELETE FROM gob_outbox WHERE id=$1 AND attempts=$2', [claimed.id, claimed.attempts]);
  } catch (error) {
    // Keep only a coarse error class; handler errors can contain credentials or recipient data.
    const reason = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
    const delay = Math.min(3600, 2 ** Math.min(claimed.attempts, 12));
    await store.pool.query(`UPDATE gob_outbox SET lease_until=NULL,
      next_at=now()+($3 * interval '1 second'),last_error=$4 WHERE id=$1 AND attempts=$2`,
    [claimed.id, claimed.attempts, delay, reason]);
  }
  return true;
}
