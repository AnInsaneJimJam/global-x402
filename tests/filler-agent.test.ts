import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/app.js';
import { runOne } from '../apps/worker/worker.js';
import { verifyEvidenceJob } from '../apps/worker/jobs/verify_evidence.js';
import { ControlClient } from '../packages/contracts/client.js';
import { assignment, putRecipient } from '../packages/procurement/evidence.js';
import { confirmFixtureFunding } from '../fixtures/adapters.js';
import { fixtureMerchant, orderEmail, sign, testKey } from '../fixtures/synthetic/merchant.js';
import { runFillerAgent } from '../examples/filler-agent/agent.js';
import { buyer, context, filler, intent } from './helpers.js';

const key = testKey();
const ORDER_NO = '403-1234567-7654321';
const recipient = { name: 'Alice Doe', line1: '1 Synthetic Street', city: 'Demo City', state: 'Demo State', postalCode: '000000', country: 'SG' };
const policy = { assetId: intent.assetId, network: intent.network, currency: 'INR', targetUnits: '10000000', allowedOvershootUnits: '0',
  confirmedUnits: '0', reservedUnits: '0', remainingFiatMinor: '10000', latestClaimableAt: '2030-01-01T00:00:00Z' };

async function setup() {
  const c = await context();
  const dir = await mkdtemp(join(tmpdir(), 'gob-agent-'));
  process.env.EVIDENCE_DIR = join(dir, 'evidence');
  const app = createApp(c.service, new Map([['fixture-buyer', buyer], ['fixture-filler', filler]]));
  // Route the real HTTP client through Fastify inject (same handlers, auth and parsers as the server).
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const response = await app.inject({ method: (init?.method ?? 'GET') as 'GET' | 'POST', url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(init?.body === undefined || init.body === null ? {} : { payload: init.body as string | Buffer }) });
    return new Response(response.body, { status: response.statusCode });
  };
  const client = new ControlClient('http://localhost:3000', 'fixture-filler', transport);
  const plan = await c.service.prepare(buyer, { command: 'create_intent', input: { ...intent, clientOrderId: 'agent',
    itemTitle: 'Coca-Cola Original 330ml', currency: 'INR', fiatMinor: '5000', recipientRef: 'r-agent' } });
  const orderId = (await c.service.act(buyer, plan.id, 'create-agent')).orderId;
  await putRecipient(c.store, buyer, 'r-agent', recipient);
  // Stand-in for Track A's chain observer: confirm funding once the agent has claimed.
  const fund = async () => {
    const view = await c.service.inspect(buyer, orderId);
    if (!view.claimId || view.facts.some(f => f.key === 'funding' && f.value === 'CONFIRMED')) return;
    await confirmFixtureFunding(c.store, orderId, view.claimId);
    await c.store.pool.query('UPDATE gob_orders SET data = data || $2::jsonb WHERE id=$1', [orderId, JSON.stringify({
      fundedAt: '2026-10-07T09:00:00Z', escrow: { escrowId: 'e', sellerAgentId: 's', buyerWalletRef: 'b', assetId: intent.assetId,
        grossBaseUnits: '1', nativeState: 'FundsLocked', lastObservedAt: null, deadlines: { payBy: '2026-10-07T09:00:00Z',
          submitResultBy: '2026-10-07T12:00:00Z', unlockAt: '2026-10-07T13:00:00Z', externalDisputeUnlockAt: '2026-10-07T14:00:00Z' } } })]);
  };
  const worker = { verify_evidence: verifyEvidenceJob({ merchants: { 'fixture-merchant': fixtureMerchant },
    resolveDkimKey: async () => key.record, evidenceDir: process.env.EVIDENCE_DIR, now: () => new Date('2026-10-07T10:05:00Z') }) };
  const close = async () => { delete process.env.EVIDENCE_DIR; await app.close(); await c.close(); await rm(dir, { recursive: true, force: true }); };
  return { c, dir, client, orderId, fund, worker, close };
}

test('filler agent ranks, claims, waits for funding, hands checkout to the human and gets a PASS', async () => {
  const s = await setup();
  try {
    const asked: string[] = [], said: string[] = [];
    const view = await runFillerAgent({
      client: s.client, actor: filler, journalDir: join(s.dir, 'journal'), policy, settlementEstimateMs: 3600_000,
      say: line => said.push(line), pollMs: 0, maxPolls: 5, readFile: path => readFile(path),
      // Each wait tick plays the other actors: fund after claim, then run the verification worker.
      sleep: async () => { await s.fund(); while (await runOne(s.c.store, s.worker)) { /* drain */ } },
      ask: async question => {
        asked.push(question);
        if (question.includes('merchant order number')) {
          assert.match(question, /name: GOB-[A-Z2-9]{6} Alice Doe/);
          return ORDER_NO;
        }
        const nonce = (await assignment(s.c.store, filler, s.orderId)).nonce!;
        const path = join(s.dir, 'confirmation.eml');
        await writeFile(path, await sign(orderEmail({ nonce }), key.privateKey));
        return path;
      },
    });
    assert.equal(view?.outcome.verification, 'PASS', said.join('\n'));
    assert.equal(asked.filter(q => q.includes('merchant order number')).length, 1);
    assert.ok(said.some(line => line.startsWith(`Chose ${s.orderId}`)));
  } finally { await s.close(); }
});

test('an unsure checkout answer stops the agent without a second purchase', async () => {
  const s = await setup();
  try {
    const said: string[] = [];
    const deps = { client: s.client, actor: filler, journalDir: join(s.dir, 'journal'), policy, settlementEstimateMs: 3600_000,
      say: (line: string) => said.push(line), pollMs: 0, maxPolls: 5, readFile: (path: string) => readFile(path),
      sleep: async () => { await s.fund(); } };
    const first = await runFillerAgent({ ...deps, ask: async () => 'unsure' });
    assert.equal(first?.actions.find(a => a.command === 'register_purchase')?.status, 'BLOCKED');
    assert.ok(said.some(line => line.includes('Do NOT order again')));
    // Rerun on the same order reconciles via lookup instead of placing a new order.
    const questions: string[] = [];
    await runFillerAgent({ ...deps, orderId: s.orderId, ask: async q => { questions.push(q); return 'none'; } });
    assert.ok(questions.every(q => q.includes('previous checkout may have gone through')));
  } finally { await s.close(); }
});
