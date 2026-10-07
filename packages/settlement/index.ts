import type { Deadlines } from '../contracts/index.js';

export type Funds = { amount: string; unit: string };
// Everything the buyer side must echo to lock funds against the seller's payment request.
export type EscrowTerms = {
  escrowId: string; agentIdentifier: string; inputHash: string; identifierFromPurchaser: string;
  sellerVkey: string; sellerReturnAddress: string | null; smartContractAddress: string;
  supportedPaymentSourceIndex: number; forceLayer: string | null; amounts: Funds[]; deadlines: Deadlines;
};
export type EscrowObservation = {
  purchaseState: string | null; paymentState: string | null; purchaseAction: string | null; paymentAction: string | null;
  error: string | null; txs: { kind: string; txHash: string; status: string }[]; observedAt: string;
};
// Domain-level escrow operations. Implementations: MasumiNative (live node) and ScriptedSettlement (tests).
export interface SettlementAdapter {
  readonly execution: 'LIVE' | 'MOCK';
  createEscrowTerms(i: { termsHash: string; agentIdentifier: string; amounts: Funds[]; deadlines: Deadlines; metadata: string }): Promise<EscrowTerms>;
  fund(terms: EscrowTerms): Promise<void>;
  observe(escrowId: string): Promise<EscrowObservation>;
  submitResult(escrowId: string, resultHash: string): Promise<void>;
  requestRefund(escrowId: string): Promise<void>;
  authorizeRefund(escrowId: string): Promise<void>;
}

// Deadlines chosen by the coordinator. Masumi requires payBy ≤ submitResult−5m, submitResult ≥ now+15m,
// unlock ≥ submitResult+15m, dispute ≥ unlock+15m. The result window must cover a human checkout + email.
export function escrowDeadlines(now: Date, resultWindowMinutes = Number(process.env.ESCROW_RESULT_WINDOW_MIN ?? 60)): Deadlines {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  const result = Math.max(20, resultWindowMinutes);
  return { payBy: at(10), submitResultBy: at(result), unlockAt: at(result + 16), externalDisputeUnlockAt: at(result + 32) };
}
