// Buyer agent as an MCP server: the user's Claude becomes the buyer. Tools post the order, fund escrow with the
// buyer's OWN Masumi key (the agent makes the transaction), follow status, review proof and request refunds.
// Config (in the Claude MCP server env): GOB_API, GOB_BUYER_TOKEN, BUYER_MASUMI_URL, BUYER_MASUMI_TOKEN,
// BUYER_PROFILE (JSON: recipient + policy; see profile.example.json). Speaks MCP JSON-RPC over stdio.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ControlClient } from '../../packages/contracts/client.js';
import type { Recipient } from '../../packages/contracts/index.js';
import { MasumiNative } from '../../packages/settlement/masumi-native.js';
import type { EscrowTerms } from '../../packages/settlement/index.js';

type Profile = { recipientRef: string; recipient: Recipient;
  policy: { allowedMerchants: string[]; maxEscrowBaseUnits: string; assetId: string; minResultWindowMinutes: number } };
const env = (name: string) => process.env[name] || (() => { throw new Error(`Missing ${name} in the MCP server config`); })();
const profile = JSON.parse(readFileSync(env('BUYER_PROFILE'), 'utf8')) as Profile;
const client = new ControlClient(process.env.GOB_API ?? 'http://127.0.0.1:3000', env('GOB_BUYER_TOKEN'));
const wallet = new MasumiNative({ url: env('BUYER_MASUMI_URL'), token: env('BUYER_MASUMI_TOKEN') }, { url: '', token: '' });
const explorer = (tx: string) => `https://preprod.cardanoscan.io/transaction/${tx}`;

// Funds once per order: an in-process lock plus the coordinator's funding fact (set by the fund_escrow commit).
// ponytail: two buyer MCP processes could still race between wallet.fund and the commit; one process per buyer is assumed.
const funding = new Set<string>();
async function fund(orderId: string) {
  if (funding.has(orderId)) return { submitted: 'Funding for this order is already in progress.' };
  funding.add(orderId);
  try {
    const view = await client.inspect(orderId);
    if (view.facts.some(f => f.key === 'funding' && f.value !== 'NOT_OBSERVED')) return { submitted: 'Escrow already funded for this order.' };
    const { terms, grossBaseUnits, assetId } = await client.escrowTerms(orderId);
    if (assetId !== profile.policy.assetId) throw new Error('Escrow asset differs from policy');
    if (BigInt(grossBaseUnits) > BigInt(profile.policy.maxEscrowBaseUnits)) throw new Error('Escrow amount above policy limit');
    const t = terms as EscrowTerms;
    if ((Date.parse(t.deadlines.submitResultBy) - Date.now()) / 60_000 < profile.policy.minResultWindowMinutes) throw new Error('Result window too short for a safe purchase');
    await wallet.fund(t);
    await client.commit({ command: 'fund_escrow', orderId, selfFunded: true }, `fund-${orderId}`);
    return { submitted: `Lock of ${Number(grossBaseUnits) / 1e6} tUSDM submitted from the buyer wallet`,
      next: 'Preprod confirmation plus Masumi indexing takes about 5–12 minutes; then the filler sees the delivery details and places the order.' };
  } finally { funding.delete(orderId); }
}

// Auto-fund: the buyer approved the order and its payout when placing it, so fund as soon as a filler claims it.
const watched = new Map<string, string>();
function watch(orderId: string) {
  if (watched.has(orderId)) return;
  watched.set(orderId, 'on: waiting for a filler to claim');
  const timer = setInterval(async () => {
    try {
      const view = await client.inspect(orderId);
      if (view.facts.some(f => f.key === 'funding' && f.value !== 'NOT_OBSERVED')) {
        if (!watched.get(orderId)?.startsWith('auto-funded')) watched.set(orderId, 'done: escrow already funded');
        return clearInterval(timer);
      }
      if (view.actions.some(x => x.command === 'fund_escrow' && x.status === 'AVAILABLE'))
        watched.set(orderId, `auto-funded ${new Date().toISOString()}: ${(await fund(orderId)).submitted}`);
    } catch (error) {
      watched.set(orderId, `auto-fund failed: ${(error as Error).message}. Call fund_escrow manually.`);
      clearInterval(timer);
    }
  }, 10_000);
}

async function status(orderId: string) {
  const v = await client.inspect(orderId);
  const fact = (key: string) => v.facts.find(f => f.key === key)?.value as Record<string, unknown> | string | undefined;
  const escrow = fact('escrow') as { nativeState?: string; deadlines?: unknown; txs?: { kind: string; txHash: string }[] } | undefined;
  const verification = fact('verification') as { verdict?: string; criteria?: { id: string; result: string }[] } | undefined;
  return { summary: v.summary, funding: fact('funding'), verification: v.outcome.verification, settlement: v.outcome.settlement,
    failedChecks: verification?.criteria?.filter(c => c.result !== 'PASS').map(c => `${c.id}: ${c.result}`) ?? [],
    escrowState: escrow?.nativeState, deadlines: escrow?.deadlines, transactions: (escrow?.txs ?? []).map(t => ({ kind: t.kind, link: explorer(t.txHash) })),
    availableActions: v.actions.filter(x => x.status === 'AVAILABLE').map(x => x.command), labels: v.integration,
    autoFund: watched.get(orderId) ?? 'off (call wait_for_update to turn it on)' };
}

const tools = {
  get_buyer_profile: {
    description: 'Show the configured delivery recipient (city/state only) and spending policy for this buyer.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => ({ deliverTo: `${profile.recipient.city}, ${profile.recipient.state}, ${profile.recipient.country}`,
      policy: { ...profile.policy, maxEscrowTUSDM: Number(profile.policy.maxEscrowBaseUnits) / 1e6 } }),
  },
  place_order: {
    description: 'Post a purchase for a filler to fulfil. Use the exact product title as shown on the merchant site, the total price in INR including delivery, and the tUSDM the filler is paid from escrow.',
    inputSchema: { type: 'object', required: ['item_title', 'total_inr', 'tusdm'], properties: {
      item_title: { type: 'string', description: 'Exact product title as the merchant shows it' },
      item_url: { type: 'string', description: 'Product page link on amazon.in (https://www.amazon.in/…); the filler opens it to buy' },
      total_inr: { type: 'number', description: 'Order total in INR including delivery, e.g. 140' },
      tusdm: { type: 'number', description: 'tUSDM paid to the filler from escrow, e.g. 2' },
      quantity: { type: 'integer', minimum: 1, default: 1 },
      merchant: { type: 'string', enum: ['amazon-in'], default: 'amazon-in' } } },
    run: async (a: { item_title: string; item_url?: string; total_inr: number; tusdm: number; quantity?: number; merchant?: string }) => {
      const merchant = a.merchant ?? 'amazon-in', units = String(Math.round(a.tusdm * 1e6)), paise = String(Math.round(a.total_inr * 100));
      if (!profile.policy.allowedMerchants.includes(merchant)) throw new Error(`Policy: merchant ${merchant} not allowed`);
      if (BigInt(units) > BigInt(profile.policy.maxEscrowBaseUnits)) throw new Error('Policy: amount above this buyer\'s escrow limit');
      await client.putRecipient(profile.recipientRef, profile.recipient);
      const receipt = await client.commit({ command: 'create_intent', input: { clientOrderId: randomUUID(), merchantId: merchant,
        sku: `${merchant}-item`, itemTitle: a.item_title, ...(a.item_url ? { itemUrl: a.item_url.split('?')[0] } : {}), quantity: a.quantity ?? 1, recipientRef: profile.recipientRef, currency: 'INR',
        fiatMinor: paise, netTokenUnits: units, assetId: profile.policy.assetId, network: 'cardano:preprod' } }, `intent-${randomUUID()}`);
      watch(receipt.orderId);
      return { orderId: receipt.orderId, posted: `${a.item_title} × ${a.quantity ?? 1}, ₹${a.total_inr} → ${a.tusdm} tUSDM`,
        next: 'Auto-funding is on: the escrow is funded as soon as a filler claims. Call wait_for_update to follow the order.' };
    },
  },
  get_order_status: {
    description: 'Current state of an order: plain-language summary, funding, proof verification, settlement, deadlines, transactions and what can be done next.',
    inputSchema: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } },
    run: async (a: { order_id: string }) => status(a.order_id),
  },
  wait_for_update: {
    description: 'Wait (up to ~4 minutes) until the order changes — a filler claims, the escrow locks, the proof is verified, or it settles — then return the new status. Call again to keep following. Also turns on auto-funding for this order.',
    inputSchema: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' },
      max_seconds: { type: 'integer', minimum: 10, maximum: 240, default: 240 } } },
    run: async (a: { order_id: string; max_seconds?: number }) => {
      watch(a.order_id);
      const key = (s: Awaited<ReturnType<typeof status>>) =>
        JSON.stringify([s.summary, s.funding, s.verification, s.settlement, s.transactions.length, s.autoFund]);
      const first = await status(a.order_id), until = Date.now() + Math.min(a.max_seconds ?? 240, 240) * 1000;
      while (Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 10_000));
        const now = await status(a.order_id);
        if (key(now) !== key(first)) return { changed: true, ...now };
      }
      return { changed: false, ...first };
    },
  },
  fund_escrow: {
    description: 'Lock the agreed tUSDM in Masumi escrow for the filler who claimed the order. The agent signs this with the buyer\'s own wallet key. Only works once a filler has claimed and escrow terms exist.',
    inputSchema: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } },
    run: async (a: { order_id: string }) => fund(a.order_id),
  },
  review_evidence: {
    description: 'Approve or reject proof that did not pass automatically. Rejecting also asks the escrow for a refund.',
    inputSchema: { type: 'object', required: ['order_id', 'decision'], properties: { order_id: { type: 'string' }, decision: { type: 'string', enum: ['APPROVE', 'REJECT'] } } },
    run: async (a: { order_id: string; decision: 'APPROVE' | 'REJECT' }) => {
      await client.commit({ command: 'review_evidence', orderId: a.order_id, decision: a.decision }, `review-${a.order_id}`);
      if (a.decision === 'REJECT') await client.commit({ command: 'request_refund', orderId: a.order_id }, `refund-${a.order_id}`);
      return { done: a.decision === 'APPROVE' ? 'Approved; result goes to escrow.' : 'Rejected and refund requested.' };
    },
  },
  request_refund: {
    description: 'Ask the escrow to refund the buyer (before the result is final).',
    inputSchema: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } },
    run: async (a: { order_id: string }) => {
      await client.commit({ command: 'request_refund', orderId: a.order_id }, `refund-${a.order_id}`);
      return { done: 'Refund requested from escrow.' };
    },
  },
} as const;

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on('line', async line => {
  if (!line.trim()) return;
  const msg = JSON.parse(line) as { id?: number | string; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  const reply = (result: unknown) => msg.id !== undefined && send({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} },
    serverInfo: { name: 'global-order-book-buyer', version: '0.1.0' } });
  if (msg.method === 'ping') return reply({});
  if (msg.method === 'tools/list') return reply({ tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
  if (msg.method === 'tools/call') {
    const tool = tools[msg.params?.name as keyof typeof tools];
    try {
      if (!tool) throw new Error(`Unknown tool ${msg.params?.name}`);
      const result = await (tool.run as (a: unknown) => Promise<unknown>)(msg.params?.arguments ?? {});
      return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (error) { return reply({ content: [{ type: 'text', text: String((error as Error).message) }], isError: true }); }
  }
  if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
});
