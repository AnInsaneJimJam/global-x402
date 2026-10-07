import type { OutboxJob } from '../../../packages/procurement/outbox.js';
import type { Store } from '../../../packages/procurement/store.js';

export type JobHandler = (job: OutboxJob, store: Store) => Promise<void>;
export type JobHandlers = Record<string, JobHandler>;

// Add each production job here after its handler and idempotent external operation exist.
export const handlers: JobHandlers = {};
