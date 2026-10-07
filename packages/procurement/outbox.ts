import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export type OutboxJob = {
  id: string; kind: string; orderId: string; dedupeKey: string; payload: unknown;
  attempts: number;
};

export async function enqueue(db: pg.PoolClient, job: { kind: string; orderId: string;
  dedupeKey: string; payload: unknown }): Promise<void> {
  await db.query(
    'INSERT INTO gob_outbox(id,kind,order_id,dedupe_key,payload) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dedupe_key) DO NOTHING',
    [randomUUID(), job.kind, job.orderId, job.dedupeKey, JSON.stringify(job.payload)],
  );
}
