import type { EscrowObservation, EscrowTerms, SettlementAdapter } from '../packages/settlement/index.js';

// Test double for the escrow lifecycle. Tests drive the "chain" by setting state; no network involved.
export class ScriptedSettlement implements SettlementAdapter {
  readonly execution = 'MOCK' as const;
  readonly escrows = new Map<string, { terms: EscrowTerms; purchaseState: string | null; paymentState: string | null; resultHash?: string }>();
  calls: string[] = [];
  async createEscrowTerms(i: Parameters<SettlementAdapter['createEscrowTerms']>[0]) {
    this.calls.push('createEscrowTerms');
    const terms: EscrowTerms = { escrowId: `escrow-${i.termsHash.slice(0, 16)}`, agentIdentifier: i.agentIdentifier, inputHash: i.termsHash,
      identifierFromPurchaser: 'aa'.repeat(10), sellerVkey: 'seller-vkey', sellerReturnAddress: null, smartContractAddress: 'addr_test1script',
      supportedPaymentSourceIndex: 0, forceLayer: null, amounts: i.amounts, deadlines: i.deadlines };
    this.escrows.set(terms.escrowId, { terms, purchaseState: null, paymentState: null });
    return terms;
  }
  async fund(terms: EscrowTerms) { this.calls.push('fund'); this.set(terms.escrowId, 'FundsLocked'); }
  async observe(escrowId: string): Promise<EscrowObservation> {
    const e = this.escrows.get(escrowId);
    return { purchaseState: e?.purchaseState ?? null, paymentState: e?.paymentState ?? null, purchaseAction: null, paymentAction: null,
      error: null, txs: e?.purchaseState ? [{ kind: 'purchase', txHash: `tx-lock-${escrowId}`, status: 'Confirmed' }] : [],
      observedAt: new Date().toISOString() };
  }
  async submitResult(escrowId: string, resultHash: string) {
    this.calls.push('submitResult');
    const e = this.escrows.get(escrowId)!; e.resultHash = resultHash; this.set(escrowId, 'ResultSubmitted');
  }
  async requestRefund(escrowId: string) { this.calls.push('requestRefund'); this.set(escrowId, 'RefundRequested'); }
  async authorizeRefund(escrowId: string) { this.calls.push('authorizeRefund'); this.set(escrowId, 'RefundAuthorized'); }
  set(escrowId: string, state: string) { const e = this.escrows.get(escrowId)!; e.purchaseState = state; e.paymentState = state; }
}
