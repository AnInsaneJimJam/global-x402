import { amount, DomainError } from '../contracts/index.js';

export type Opportunity = {
  id: string; assetId: string; network: string; currency: string;
  fiatMinor: string; netTokenUnits: string; estimatedClaimableAt: string;
};
export type AcquisitionPolicy = {
  assetId: string; network: string; currency: string;
  targetUnits: string; allowedOvershootUnits: string; confirmedUnits: string; reservedUnits: string;
  remainingFiatMinor: string; latestClaimableAt: string;
};
// Compare exact integer ratios for comparable units; never use floating point or
// invent an FX conversion. Unknown quotes must be excluded before this function.
export function rankOpportunities(offers: Opportunity[], policy: AcquisitionPolicy) {
  const target = BigInt(amount.parse(policy.targetUnits)) + BigInt(amount.parse(policy.allowedOvershootUnits));
  const acquired = BigInt(amount.parse(policy.confirmedUnits)) + BigInt(amount.parse(policy.reservedUnits));
  const remainingFiat = BigInt(amount.parse(policy.remainingFiatMinor));
  const latest = Date.parse(policy.latestClaimableAt);
  if (!Number.isFinite(latest)) throw new DomainError('INVALID_POLICY_DEADLINE', 422);
  const candidates: Opportunity[] = []; const exclusions: { id: string; reason: string }[] = [];
  for (const offer of offers) {
    const fiat = BigInt(amount.parse(offer.fiatMinor)); const net = BigInt(amount.parse(offer.netTokenUnits));
    const claimable = Date.parse(offer.estimatedClaimableAt);
    const reason = offer.assetId !== policy.assetId || offer.network !== policy.network || offer.currency !== policy.currency ? 'INCOMPARABLE_UNITS' :
      net <= 0n || !Number.isFinite(claimable) ? 'UNKNOWN_OR_INVALID_ECONOMICS' :
      fiat > remainingFiat ? 'FIAT_LIMIT' : acquired + net > target ? 'TARGET_CAPACITY' :
      claimable > latest ? 'SETTLEMENT_TOO_LATE' : null;
    if (reason) exclusions.push({ id: offer.id, reason }); else candidates.push(offer);
  }
  candidates.sort((a, b) => {
    const left = BigInt(a.fiatMinor) * BigInt(b.netTokenUnits);
    const right = BigInt(b.fiatMinor) * BigInt(a.netTokenUnits);
    if (left !== right) return left < right ? -1 : 1;
    const time = Date.parse(a.estimatedClaimableAt) - Date.parse(b.estimatedClaimableAt);
    return time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  return { candidates, exclusions, comparisonScope: 'SUPPLIED_SUPPORTED_OFFERS_ONLY' };
}
