import type { OutboxJob } from '../../../packages/procurement/outbox.js';

export type JobHandler = (job: OutboxJob) => Promise<void>;
export type JobHandlers = Record<string, JobHandler>;

// Add each production job here after its handler and idempotent external operation exist.
export const handlers: JobHandlers = {};
