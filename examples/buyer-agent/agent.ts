import type { Recipient } from '../../packages/contracts/index.js';
import type { ControlClient } from '../../packages/contracts/client.js';

type View = Awaited<ReturnType<ControlClient['inspect']>>;
export type Purchase = { clientOrderId: string; merchantId: string; sku: string; itemTitle: string; quantity: number;
  currency: 'INR' | 'SGD' | 'USD'; fiatMinor: string; netTokenUnits: string; assetId: string; recipientRef: string; recipient: Recipient };
export type BuyerPolicy = { allowedMerchants: string[]; maxEscrowBaseUnits: string; minResultWindowMinutes: number };
export type BuyerAgentDeps = {
  client: ControlClient; purchase: Purchase; policy: BuyerPolicy; say: (line: string) => void;
  // Called only when evidence did not pass automatically; returns the buyer's decision.
  review: (view: View) => Promise<'APPROVE' | 'REJECT'>;
  sleep: (ms: number) => Promise<void>; pollMs?: number; maxPolls?: number; now?: () => Date;
};

const done = (v: View) => ['PAID', 'REFUNDED'].includes(v.outcome.settlement);
const fact = (v: View, key: string) => v.facts.find(f => f.key === key)?.value as Record<string, unknown> | string | undefined;

// Deterministic buyer loop: post the exact purchase, fund only escrow terms that match its policy, decide manual
// reviews, and follow settlement to payout or refund. Re-running with the same clientOrderId resumes the same order.
export async function runBuyerAgent(d: BuyerAgentDeps): Promise<View> {
  const p = d.purchase;
  if (!d.policy.allowedMerchants.includes(p.merchantId)) throw new Error(`POLICY_MERCHANT_NOT_ALLOWED: ${p.merchantId}`);
  if (BigInt(p.netTokenUnits) > BigInt(d.policy.maxEscrowBaseUnits)) throw new Error('POLICY_AMOUNT_ABOVE_LIMIT');
  await d.client.putRecipient(p.recipientRef, p.recipient);
  const create = await d.client.prepare({ command: 'create_intent', input: { clientOrderId: p.clientOrderId, merchantId: p.merchantId,
    sku: p.sku, itemTitle: p.itemTitle, quantity: p.quantity, recipientRef: p.recipientRef, currency: p.currency,
    fiatMinor: p.fiatMinor, netTokenUnits: p.netTokenUnits, assetId: p.assetId, network: 'cardano:preprod' } });
  const orderId = (await d.client.act(create, `intent-${p.clientOrderId}`)).orderId;
  d.say(`Posted order ${orderId}: ${p.itemTitle} × ${p.quantity} for ${(Number(p.fiatMinor) / 100).toFixed(2)} ${p.currency}, ` +
    `paying ${p.netTokenUnits} base units of ${p.assetId.split('.').at(-1)} to whoever fills it.`);

  let view = await wait(d, orderId, v => v.actions.some(a => a.command === 'fund_escrow' && a.status === 'AVAILABLE') ||
    v.facts.some(f => f.key === 'funding' && f.value !== 'NOT_OBSERVED'), 'a filler to claim and escrow terms');
  if (view.facts.some(f => f.key === 'funding' && f.value === 'NOT_OBSERVED')) {
    const escrow = fact(view, 'escrow') as { grossBaseUnits: string; assetId: string; deadlines: { submitResultBy: string } };
    const windowMinutes = (Date.parse(escrow.deadlines.submitResultBy) - (d.now?.() ?? new Date()).getTime()) / 60_000;
    if (escrow.grossBaseUnits !== p.netTokenUnits || escrow.assetId !== p.assetId) throw new Error('ESCROW_TERMS_MISMATCH');
    if (windowMinutes < d.policy.minResultWindowMinutes) throw new Error('ESCROW_RESULT_WINDOW_TOO_SHORT');
    await d.client.commit({ command: 'fund_escrow', orderId }, `fund-${orderId}`);
    d.say(`Escrow terms match policy; funding ${escrow.grossBaseUnits} base units (result due by ${escrow.deadlines.submitResultBy}).`);
  }
  view = await wait(d, orderId, v => v.facts.some(f => f.key === 'funding' && f.value === 'CONFIRMED'), 'the escrow lock on chain');
  d.say('Escrow locked. The filler can now see the delivery address and place the order.');

  for (;;) {
    view = await wait(d, orderId, v => done(v) || v.actions.some(a => a.command === 'review_evidence' && a.status === 'AVAILABLE') ||
      v.outcome.verification === 'PASS' && v.outcome.settlement !== 'NONE', 'proof of order placement or settlement');
    if (done(view)) break;
    if (view.actions.some(a => a.command === 'review_evidence' && a.status === 'AVAILABLE')) {
      const decision = await d.review(view);
      await d.client.commit({ command: 'review_evidence', orderId, decision }, `review-${orderId}`);
      d.say(`Manual review: ${decision === 'APPROVE' ? 'approved' : 'rejected'} the evidence.`);
      if (decision === 'REJECT') {
        await d.client.commit({ command: 'request_refund', orderId }, `refund-${orderId}`);
        d.say('Requested a refund from escrow.');
      }
      continue;
    }
    d.say(`Order placement verified (${view.outcome.verification}); result submitted to escrow. Waiting for the dispute window and payout.`);
    view = await wait(d, orderId, done, 'final settlement');
    break;
  }
  d.say(`Final: settlement ${view.outcome.settlement}, verification ${view.outcome.verification}.`);
  return view;
}

async function wait(d: BuyerAgentDeps, orderId: string, ready: (view: View) => boolean, what: string) {
  for (let poll = 0; poll < (d.maxPolls ?? 2_000); poll++) {
    const view = await d.client.inspect(orderId);
    if (ready(view)) return view;
    if (poll === 0) d.say(`Waiting for ${what}…`);
    await d.sleep(d.pollMs ?? 10_000);
  }
  throw new Error(`TIMEOUT_WAITING_FOR_${what.toUpperCase().replace(/[^A-Z]+/g, '_')}`);
}
