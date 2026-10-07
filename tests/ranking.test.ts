import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankOpportunities } from '../packages/procurement/ranking.js';

test('ranking uses exact ratios and retains pending target reservations', () => {
  const base = { assetId: 'fixture:test-token', network: 'cardano:preprod', currency: 'USD',
    netTokenUnits: '5100000', estimatedClaimableAt: '2026-10-07T01:00:00Z' };
  const policy = { assetId: base.assetId, network: base.network, currency: base.currency,
    targetUnits: '10000000', allowedOvershootUnits: '200000', confirmedUnits: '0', reservedUnits: '0',
    remainingFiatMinor: '600', latestClaimableAt: '2026-10-07T02:00:00Z' };
  const offers = [
    { ...base, id: 'expensive', fiatMinor: '501' },
    { ...base, id: 'tie-b', fiatMinor: '500' },
    { ...base, id: 'tie-a', fiatMinor: '500' },
    { ...base, id: 'other-network', fiatMinor: '100', network: 'cardano:mainnet' },
  ];
  assert.deepEqual(rankOpportunities(offers, policy).candidates.map(o => o.id), ['tie-a', 'tie-b', 'expensive']);
  const result = rankOpportunities(offers, { ...policy, reservedUnits: '6000000' });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.exclusions.find(o => o.id === 'tie-a')?.reason, 'TARGET_CAPACITY');
});
