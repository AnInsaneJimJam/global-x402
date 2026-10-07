import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export type OutboxJob = {
  id: string; kind: string; orderId: string; dedupeKey: string; payload: unknown;
  attempts: number;
};

export async function enqueue(db: pg.PoolClient | pg.Pool, job: { kind: string; orderId: string;
  dedupeKey: string; payload: unknown; notBefore?: Date }): Promise<void> {
  await db.query(
    'INSERT INTO gob_outbox(id,kind,order_id,dedupe_key,payload,next_at) VALUES ($1,$2,$3,$4,$5,COALESCE($6,now())) ON CONFLICT (dedupe_key) DO NOTHING',
    [randomUUID(), job.kind, job.orderId, job.dedupeKey, JSON.stringify(job.payload), job.notBefore ?? null],
  );
}
