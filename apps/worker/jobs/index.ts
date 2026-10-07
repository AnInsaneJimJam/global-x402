import type { OutboxJob } from '../../../packages/procurement/outbox.js';
import type { Store } from '../../../packages/procurement/store.js';
import { verifyEvidence } from './verify_evidence.js';
import { settlementJobs } from './settlement.js';
import { MasumiNative } from '../../../packages/settlement/masumi-native.js';

export type JobHandler = (job: OutboxJob, store: Store) => Promise<void>;
export type JobHandlers = Record<string, JobHandler>;

// Add each production job here after its handler and idempotent external operation exist.
// Settlement jobs run only when the Masumi node is configured; otherwise those jobs wait (retry with backoff).
const settlement = process.env.BUYER_MASUMI_TOKEN && process.env.FILLER_AGENT_IDENTIFIER
  ? settlementJobs({ adapter: MasumiNative.fromEnv(), agentIdentifier: process.env.FILLER_AGENT_IDENTIFIER }) : {};
export const handlers: JobHandlers = {
  verify_evidence: verifyEvidence,
  ...settlement,
};
