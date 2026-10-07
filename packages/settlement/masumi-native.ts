import { createHash } from 'node:crypto';
import type { EscrowObservation, EscrowTerms, Funds, SettlementAdapter } from './index.js';

type Side = { url: string; token: string };
type Row = { onChainState?: string | null; NextAction?: { requestedAction?: string; errorNote?: string | null } | null;
  CurrentTransaction?: { txHash: string | null; status: string } | null;
  TransactionHistory?: { txHash: string | null; status: string }[] | null };
const iso = (ms: string) => new Date(Number(ms)).toISOString();
const ms = (time: string) => String(Date.parse(time));

// Native Masumi (MIP-003, payment source Web3CardanoV2) on one operator-held Preprod node.
// Seller calls use the filler's scoped key, buyer calls the buyer's; the node signs with the matching hot wallet.
export class MasumiNative implements SettlementAdapter {
  readonly execution = 'LIVE' as const;
  constructor(readonly buyer: Side, readonly filler: Side, readonly network = 'Preprod', readonly sourceIndex = 0) {}

  static fromEnv(env = process.env) {
    const need = (name: string) => env[name] || (() => { throw new Error(`MASUMI_NOT_CONFIGURED: ${name}`); })();
    return new MasumiNative({ url: need('BUYER_MASUMI_URL'), token: need('BUYER_MASUMI_TOKEN') },
      { url: need('FILLER_MASUMI_URL'), token: need('FILLER_MASUMI_TOKEN') });
  }

  private async call(side: Side, path: string, body: unknown) {
    const response = await fetch(`${side.url}${path}`, { method: 'POST', body: JSON.stringify(body),
      headers: { token: side.token, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000) });
    const json = await response.json().catch(() => ({})) as { data?: unknown; object?: unknown; error?: { message?: string } };
    // 409 "… exists" on create is an idempotent replay of the same request.
    if (response.status === 409 && /exists/i.test(json.error?.message ?? '')) return json.object;
    if (!response.ok) throw new Error(`MASUMI_HTTP_${response.status}: ${(json.error?.message ?? '').slice(0, 120)}`);
    return json.data;
  }

  async createEscrowTerms(i: { termsHash: string; agentIdentifier: string; amounts: Funds[]; deadlines: EscrowTerms['deadlines']; metadata: string }) {
    const identifierFromPurchaser = createHash('sha256').update(`purchaser:${i.termsHash}`).digest('hex').slice(0, 20);
    const p = await this.call(this.filler, '/payment', { network: this.network, agentIdentifier: i.agentIdentifier,
      inputHash: i.termsHash, identifierFromPurchaser, paymentSourceType: 'Web3CardanoV2',
      supportedPaymentSourceIndex: this.sourceIndex, RequestedFunds: i.amounts, metadata: i.metadata,
      payByTime: i.deadlines.payBy, submitResultTime: i.deadlines.submitResultBy,
      unlockTime: i.deadlines.unlockAt, externalDisputeUnlockTime: i.deadlines.externalDisputeUnlockAt }) as {
      blockchainIdentifier: string; payByTime: string; submitResultTime: string; unlockTime: string; externalDisputeUnlockTime: string;
      SmartContractWallet: { walletVkey: string }; sellerReturnAddress: string | null; forceLayer: string | null;
      PaymentSource: { smartContractAddress: string }; RequestedFunds: Funds[] };
    return { escrowId: p.blockchainIdentifier, agentIdentifier: i.agentIdentifier, inputHash: i.termsHash, identifierFromPurchaser,
      sellerVkey: p.SmartContractWallet.walletVkey, sellerReturnAddress: p.sellerReturnAddress ?? null,
      smartContractAddress: p.PaymentSource.smartContractAddress, supportedPaymentSourceIndex: this.sourceIndex,
      forceLayer: p.forceLayer ?? null, amounts: p.RequestedFunds ?? i.amounts,
      deadlines: { payBy: iso(p.payByTime), submitResultBy: iso(p.submitResultTime), unlockAt: iso(p.unlockTime),
        externalDisputeUnlockAt: iso(p.externalDisputeUnlockTime) } };
  }

  async fund(t: EscrowTerms) {
    await this.call(this.buyer, '/purchase', { network: this.network, blockchainIdentifier: t.escrowId, inputHash: t.inputHash,
      sellerVkey: t.sellerVkey, agentIdentifier: t.agentIdentifier, identifierFromPurchaser: t.identifierFromPurchaser,
      paymentSourceType: 'Web3CardanoV2', smartContractAddress: t.smartContractAddress,
      supportedPaymentSourceIndex: t.supportedPaymentSourceIndex, Amounts: t.amounts,
      ...(t.sellerReturnAddress ? { sellerReturnAddress: t.sellerReturnAddress } : {}),
      ...(t.forceLayer ? { paymentForceLayer: t.forceLayer } : {}),
      payByTime: ms(t.deadlines.payBy), submitResultTime: ms(t.deadlines.submitResultBy),
      unlockTime: ms(t.deadlines.unlockAt), externalDisputeUnlockTime: ms(t.deadlines.externalDisputeUnlockAt) });
  }

  async observe(escrowId: string): Promise<EscrowObservation> {
    const body = { blockchainIdentifier: escrowId, network: this.network, includeHistory: 'true' };
    const [purchase, payment] = await Promise.all([
      this.call(this.buyer, '/purchase/resolve-blockchain-identifier', body).catch(() => null) as Promise<Row | null>,
      this.call(this.filler, '/payment/resolve-blockchain-identifier', body).catch(() => null) as Promise<Row | null>]);
    const txs = new Map<string, { kind: string; txHash: string; status: string }>();
    for (const [kind, row] of [['purchase', purchase], ['payment', payment]] as const) {
      for (const tx of [...(row?.TransactionHistory ?? []), ...(row?.CurrentTransaction ? [row.CurrentTransaction] : [])]) {
        if (tx.txHash) txs.set(tx.txHash, { kind, txHash: tx.txHash, status: tx.status });
      }
    }
    return { purchaseState: purchase?.onChainState ?? null, paymentState: payment?.onChainState ?? null,
      purchaseAction: purchase?.NextAction?.requestedAction ?? null, paymentAction: payment?.NextAction?.requestedAction ?? null,
      error: purchase?.NextAction?.errorNote ?? payment?.NextAction?.errorNote ?? null,
      txs: [...txs.values()], observedAt: new Date().toISOString() };
  }

  async submitResult(escrowId: string, resultHash: string) {
    await this.call(this.filler, '/payment/submit-result', { network: this.network, blockchainIdentifier: escrowId, submitResultHash: resultHash });
  }
  async requestRefund(escrowId: string) {
    await this.call(this.buyer, '/purchase/request-refund', { network: this.network, blockchainIdentifier: escrowId });
  }
  async authorizeRefund(escrowId: string) {
    await this.call(this.filler, '/payment/authorize-refund', { network: this.network, blockchainIdentifier: escrowId });
  }
}
