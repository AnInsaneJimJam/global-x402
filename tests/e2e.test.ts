import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/app.js';
import { runOne } from '../apps/worker/worker.js';
import { settlementJobs } from '../apps/worker/jobs/settlement.js';
import { verifyEvidenceJob } from '../apps/worker/jobs/verify_evidence.js';
import { ControlClient } from '../packages/contracts/client.js';
import { assignment } from '../packages/procurement/evidence.js';
import { ScriptedSettlement } from '../fixtures/settlement.js';
import { fixtureMerchant, orderEmail, sign, testKey } from '../fixtures/synthetic/merchant.js';
import { runBuyerAgent } from '../examples/buyer-agent/agent.js';
import { runFillerAgent } from '../examples/filler-agent/agent.js';
import { buyer, context, filler, intent } from './helpers.js';

const key = testKey();

test('two agents: buyer posts and funds, filler buys and proves, escrow pays the filler', async () => {
  const c = await context();
  const dir = await mkdtemp(join(tmpdir(), 'gob-e2e-'));
  process.env.EVIDENCE_DIR = join(dir, 'evidence');
  const app = createApp(c.service, new Map([['fixture-buyer', buyer], ['fixture-filler', filler]]));
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const response = await app.inject({ method: (init?.method ?? 'GET') as 'GET', url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(init?.body === undefined || init.body === null ? {} : { payload: init.body as string | Buffer }) });
    return new Response(response.body, { status: response.statusCode });
  };
  const chain = new ScriptedSettlement();
  const handlers = { ...settlementJobs({ adapter: chain, agentIdentifier: 'a'.repeat(64), pollMs: 0 }),
    verify_evidence: verifyEvidenceJob({ merchants: { 'fixture-merchant': fixtureMerchant }, resolveDkimKey: async () => key.record,
      evidenceDir: process.env.EVIDENCE_DIR }) };
  // Each agent wait tick also runs the worker and, once the result is in the dispute window, lets the
  // scripted chain pay out (Masumi does this automatically after unlock).
  const tick = async () => {
    for (let n = 0; n < 10 && await runOne(c.store, handlers); n++) { /* drain */ }
    for (const [id, escrow] of chain.escrows) if (escrow.paymentState === 'ResultSubmitted') chain.set(id, 'Withdrawn');
  };
  const buyerLog: string[] = [], fillerLog: string[] = [];
  try {
    const buyerRun = runBuyerAgent({
      client: new ControlClient('http://localhost:3000', 'fixture-buyer', transport), say: line => buyerLog.push(line),
      policy: { allowedMerchants: ['fixture-merchant'], maxEscrowBaseUnits: '10000000', minResultWindowMinutes: 20 },
      purchase: { clientOrderId: 'coke-1', merchantId: 'fixture-merchant', sku: 'coke-330ml', itemTitle: 'Coca-Cola Original 330ml',
        quantity: 1, currency: 'INR', fiatMinor: '5000', netTokenUnits: '5100000', assetId: intent.assetId, recipientRef: 'home',
        recipient: { name: 'Alice Doe', line1: '1 Synthetic Street', city: 'Demo City', state: 'Demo State', postalCode: '000000', country: 'SG' } },
      review: async () => { throw new Error('no manual review expected'); },
      sleep: tick, pollMs: 0, maxPolls: 200,
    });
    // The filler starts once there is something to fill.
    while (!(await c.store.pool.query('SELECT 1 FROM gob_orders')).rowCount) await new Promise(resolve => setImmediate(resolve));
    const fillerView = await runFillerAgent({
      client: new ControlClient('http://localhost:3000', 'fixture-filler', transport), actor: filler, journalDir: join(dir, 'journal'),
      policy: { assetId: intent.assetId, network: intent.network, currency: 'INR', targetUnits: '10000000', allowedOvershootUnits: '0',
        confirmedUnits: '0', reservedUnits: '0', remainingFiatMinor: '10000', latestClaimableAt: '2030-01-01T00:00:00Z' },
      settlementEstimateMs: 3600_000, say: line => fillerLog.push(line), sleep: tick, pollMs: 0, maxPolls: 200,
      readFile: path => readFile(path),
      ask: async question => {
        if (question.includes('merchant order number')) return '403-1234567-7654321';
        const [order] = (await c.store.pool.query<{ id: string }>('SELECT id FROM gob_orders')).rows;
        const nonce = (await assignment(c.store, filler, order!.id)).nonce!;
        const path = join(dir, 'confirmation.eml');
        await writeFile(path, await sign(orderEmail({ nonce, date: new Date().toUTCString() }), key.privateKey));
        return path;
      },
    });
    const final = await buyerRun;
    assert.equal(fillerView?.outcome.verification, 'PASS', fillerLog.join('\n'));
    assert.equal(final.outcome.settlement, 'PAID', buyerLog.join('\n'));
    assert.deepEqual(chain.calls, ['createEscrowTerms', 'fund', 'submitResult']);
    assert.ok(buyerLog.some(line => line.startsWith('Escrow terms match policy')));
  } finally {
    delete process.env.EVIDENCE_DIR;
    await app.close(); await c.close(); await rm(dir, { recursive: true, force: true });
  }
});
