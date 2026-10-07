import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, hash, id, actorSchema } from '../contracts/index.js';
import type { Actor } from '../contracts/index.js';
import type { Procurement } from '../procurement/service.js';

// The coordinator operations the runtime needs: in-process Procurement or an HTTP client adapter.
export type CoordinatorPort = Pick<Procurement, 'inspect' | 'prepare' | 'act' | 'observePurchase'>;

export interface CheckoutAdapter {
  // LIVE = a real merchant checkout (e.g. human-assisted on the filler's own account).
  readonly environment: 'MOCK' | 'LIVE';
  place(input: { operationId: string; orderId: string; termsHash: string }): Promise<{ merchantOrderId: string }>;
  lookup(operationId: string): Promise<{ state: 'ORDERED'; merchantOrderId: string } | { state: 'UNKNOWN' }>;
}
type RunInput = { runId: string; actor: Actor; orderId: string; termsHash: string; checkoutAuthorized: boolean };
type Run = RunInput & { inputHash: string; stopped: boolean;
  purchase: { operationId: string; state: 'PREPARED' | 'SUBMITTING' | 'UNKNOWN' | 'ORDERED'; merchantOrderId: string | null } | null };
const runSchema = z.strictObject({
  runId: id, actor: actorSchema, orderId: id, termsHash: z.string().regex(/^[a-f0-9]{64}$/),
  checkoutAuthorized: z.boolean(), inputHash: z.string().regex(/^[a-f0-9]{64}$/), stopped: z.boolean(),
  purchase: z.strictObject({ operationId: id, state: z.enum(['PREPARED', 'SUBMITTING', 'UNKNOWN', 'ORDERED']), merchantOrderId: id.nullable() }).nullable(),
});

// Actor-local journal. A crashed lock is deliberately a recovery blocker: leases cannot
// fence external checkout. No hosted coordinator can read these files through the API.
export class ActorRuntime {
  constructor(readonly directory: string, readonly procurement: CoordinatorPort, readonly checkout: CheckoutAdapter) {}
  private path(runId: string) { return join(this.directory, `${id.parse(runId)}.json`); }
  async startRun(input: RunInput) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const record: Run = runSchema.parse({ ...input, inputHash: hash(input), stopped: false, purchase: null });
    try {
      const file = await open(this.path(input.runId), 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = await this.load(input.runId);
      if (previous.inputHash !== record.inputHash) throw new DomainError('RUN_CONFLICT');
      return previous;
    }
  }
  private async load(runId: string): Promise<Run> {
    try {
      const run = runSchema.parse(JSON.parse(await readFile(this.path(runId), 'utf8')));
      if (run.runId !== runId || !run.actor || !run.orderId || !run.inputHash || hash({ runId: run.runId,
        actor: run.actor, orderId: run.orderId, termsHash: run.termsHash, checkoutAuthorized: run.checkoutAuthorized }) !== run.inputHash) {
        throw new Error('Invalid journal');
      }
      return run;
    } catch { throw new DomainError('LOCAL_JOURNAL_UNAVAILABLE', 409, 'RECONCILE'); }
  }
  private async save(run: Run) {
    const temp = `${this.path(run.runId)}.${randomUUID()}.tmp`;
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(run)); await file.sync(); } finally { await file.close(); }
    await rename(temp, this.path(run.runId));
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  private async owned<T>(runId: string, fn: (run: Run) => Promise<T>) {
    const lockPath = `${this.path(runId)}.lock`;
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch { throw new DomainError('EXECUTOR_OR_JOURNAL_UNAVAILABLE', 409, 'RECONCILE'); }
    try { return await fn(await this.load(runId)); }
    finally { await lock.close(); await unlink(lockPath); }
  }
  async inspect(runId: string) {
    const run = await this.load(runId);
    return { run, control: await this.procurement.inspect(run.actor, run.orderId) };
  }
  async stop(runId: string) { return this.owned(runId, async run => { run.stopped = true; await this.save(run); }); }
  async resume(runId: string) { return this.owned(runId, async run => { run.stopped = false; await this.save(run); }); }

  async purchase(runId: string) {
    return this.owned(runId, async run => {
      if (run.stopped) throw new DomainError('RUN_STOPPED');
      if (run.actor.role !== 'FILLER' || !run.checkoutAuthorized) throw new DomainError('CHECKOUT_GRANT_REQUIRED', 403, 'REAUTHORIZE');
      const control = await this.procurement.inspect(run.actor, run.orderId);
      if (control.termsHash !== run.termsHash) throw new DomainError('TERMS_CHANGED');
      if (run.purchase) throw new DomainError('PURCHASE_ALREADY_REGISTERED', 409, 'RECONCILE');
      const admission = control.actions.find(action => action.command === 'register_purchase');
      if (admission?.status !== 'AVAILABLE') throw new DomainError(admission?.reasonCodes[0] ?? 'PURCHASE_NOT_AVAILABLE');
      const purchaseOperationId = randomUUID();
      const plan = await this.procurement.prepare(run.actor, { command: 'register_purchase', orderId: run.orderId, purchaseOperationId });
      // Persist the operation identity even before registration; an uncertain registration
      // must be recoverable rather than replaced under a new ID.
      run.purchase = { operationId: purchaseOperationId, state: 'PREPARED', merchantOrderId: null };
      await this.save(run);
      try { await this.procurement.act(run.actor, plan.id, `register-${purchaseOperationId}`); }
      catch (error) {
        // Domain rejections roll back admission with a definitive no-effect outcome.
        // Transport/database uncertainty keeps the persisted identity for reconciliation.
        if (error instanceof DomainError) { run.purchase = null; await this.save(run); }
        throw error;
      }
      run.purchase.state = 'SUBMITTING'; await this.save(run);
      await this.procurement.observePurchase(run.actor, run.orderId, { purchaseOperationId, state: 'SUBMITTING' });
      let result;
      try { result = await this.checkout.place({ operationId: purchaseOperationId, orderId: run.orderId, termsHash: run.termsHash }); }
      catch {
        run.purchase.state = 'UNKNOWN'; await this.save(run);
        await this.procurement.observePurchase(run.actor, run.orderId, { purchaseOperationId, state: 'UNKNOWN' });
        return this.inspect(runId);
      }
      run.purchase.state = 'ORDERED'; run.purchase.merchantOrderId = result.merchantOrderId; await this.save(run);
      await this.procurement.observePurchase(run.actor, run.orderId, { purchaseOperationId, state: 'ORDERED', merchantOrderId: result.merchantOrderId });
      return this.inspect(runId);
    });
  }
  async reconcile(runId: string) {
    return this.owned(runId, async run => {
      if (!run.purchase) return this.inspect(runId);
      const result = run.purchase.state === 'ORDERED' && run.purchase.merchantOrderId ?
        { state: 'ORDERED' as const, merchantOrderId: run.purchase.merchantOrderId } : await this.checkout.lookup(run.purchase.operationId);
      if (result.state === 'ORDERED') {
        run.purchase.state = 'ORDERED'; run.purchase.merchantOrderId = result.merchantOrderId; await this.save(run);
        await this.procurement.observePurchase(run.actor, run.orderId, {
          purchaseOperationId: run.purchase.operationId, state: 'ORDERED', merchantOrderId: result.merchantOrderId });
      }
      return this.inspect(runId);
    });
  }
}
