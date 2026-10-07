import type { Actor } from '../../packages/contracts/index.js';
import { ControlClient, httpCoordinator } from '../../packages/contracts/client.js';
import { ActorRuntime } from '../../packages/agent-runtime/index.js';
import { humanCheckout } from '../../packages/agent-runtime/human-checkout.js';
import type { Ask } from '../../packages/agent-runtime/human-checkout.js';
import { rankOpportunities } from '../../packages/procurement/ranking.js';
import type { AcquisitionPolicy } from '../../packages/procurement/ranking.js';

type View = Awaited<ReturnType<ControlClient['inspect']>>;
export type FillerAgentDeps = {
  client: ControlClient; actor: Actor; journalDir: string; policy: AcquisitionPolicy;
  settlementEstimateMs: number; ask: Ask; say: (line: string) => void;
  sleep: (ms: number) => Promise<void>; readFile: (path: string) => Promise<Uint8Array>;
  orderId?: string; pollMs?: number; maxPolls?: number; now?: () => Date;
};

// Deterministic filler loop: pick by explicit policy, claim, wait for escrow funding, hand the checkout
// to the human, submit the merchant's confirmation email, wait for the verdict. No model is consulted;
// waiting is plain polling, and an unknown checkout outcome stops the loop instead of re-buying.
export async function runFillerAgent(d: FillerAgentDeps): Promise<View | null> {
  const orderId = d.orderId ?? await chooseAndClaim(d);
  if (!orderId) return null;
  const funded = await waitFor(d, orderId, v => v.facts.some(f => f.key === 'funding' && f.value === 'CONFIRMED'), 'escrow funding');
  const a = await d.client.assignment(orderId);
  const instructions = () => [
    `Merchant: ${a.merchantId}`, `Item: ${a.itemTitle ?? '(see SKU)'} × ${a.quantity}`,
    `Pay at most: ${(Number(a.maximumChargeMinor) / 100).toFixed(2)} ${a.currency} (total incl. delivery)`,
    'Ship to (type the name EXACTLY, including the GOB code):',
    ...Object.entries(a.recipient).map(([key, value]) => `  ${key}: ${value}`), a.instructions,
  ].join('\n');
  const runtime = new ActorRuntime(d.journalDir, httpCoordinator(d.client), humanCheckout(d.ask, instructions));
  const runId = `fill-${orderId}`;
  await runtime.startRun({ runId, actor: d.actor, orderId, termsHash: funded.termsHash, checkoutAuthorized: true });
  const inspected = await runtime.inspect(runId);
  const purchased = inspected.run.purchase ? await runtime.reconcile(runId) : await runtime.purchase(runId);
  const purchase = purchased.run.purchase;
  if (purchase?.state !== 'ORDERED' || !purchase.merchantOrderId) {
    d.say('Purchase outcome is UNKNOWN. Do NOT order again. Check your merchant order history, then rerun with this order id to reconcile.');
    return purchased.control;
  }
  const path = (await d.ask('Download the merchant confirmation email as .eml (Gmail: ⋮ → Download message) and enter its file path: ')).trim();
  const upload = await d.client.uploadEvidence(orderId, await d.readFile(path));
  await d.client.commit({ command: 'submit_evidence', orderId, purchaseOperationId: purchase.operationId,
    merchantOrderId: purchase.merchantOrderId, evidenceId: upload.evidenceId }, `evidence-${orderId}-${upload.evidenceId.slice(0, 12)}`);
  const verified = await waitFor(d, orderId, v => !['NOT_STARTED', 'PENDING'].includes(v.outcome.verification), 'verification');
  d.say(`Verification: ${verified.outcome.verification}.${verified.outcome.verification === 'PASS' ? ' Result goes to escrow settlement.' :
    ' The buyer will review the evidence.'}`);
  return verified;
}

async function chooseAndClaim(d: FillerAgentDeps) {
  const { orders } = await d.client.opportunities();
  const claimableAt = new Date((d.now?.() ?? new Date()).getTime() + d.settlementEstimateMs).toISOString();
  const ranking = rankOpportunities(orders.map(o => ({ id: o.id, assetId: o.assetId, network: o.network, currency: o.currency,
    fiatMinor: o.fiatMinor, netTokenUnits: o.netTokenUnits, estimatedClaimableAt: claimableAt })), d.policy);
  d.say(`Compared ${orders.length} open order(s) (${ranking.comparisonScope}); excluded ${ranking.exclusions.length}` +
    (ranking.exclusions.length ? `: ${ranking.exclusions.map(x => `${x.id} ${x.reason}`).join(', ')}` : '') + '.');
  const chosen = ranking.candidates[0];
  if (!chosen) { d.say('No open order fits the policy. Nothing claimed.'); return null; }
  d.say(`Chose ${chosen.id}: ${chosen.netTokenUnits} token units for ${chosen.fiatMinor} ${chosen.currency} minor units ` +
    '(lowest fiat per token among eligible offers; ties by earliest settlement, then id).');
  await d.client.commit({ command: 'claim', orderId: chosen.id }, `claim-${chosen.id}`);
  return chosen.id;
}

async function waitFor(d: FillerAgentDeps, orderId: string, done: (view: View) => boolean, what: string) {
  for (let poll = 0; poll < (d.maxPolls ?? 720); poll++) {
    const view = await d.client.inspect(orderId);
    if (done(view)) return view;
    if (poll === 0) d.say(`Waiting for ${what}…`);
    await d.sleep(d.pollMs ?? 5_000);
  }
  throw new Error(`TIMEOUT_WAITING_FOR_${what.toUpperCase().replaceAll(' ', '_')}`);
}
