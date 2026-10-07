import type { ExtractedOrder, MerchantConfig } from '../merchants/index.js';
import type { Criterion, EmailVerification, ExpectedOrder } from './index.js';

// Shared, dependency-free order checks: used by the local verifier and inside the Chainlink CRE workflow,
// so both apply exactly the same rules.
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const hasToken = (text: string, token: string) => normalize(text).split(' ').includes(normalize(token));

export function evaluate(i: { expected: ExpectedOrder; merchant: MerchantConfig; facts: ExtractedOrder; placedAt: Date | null;
  dkim: { result: Criterion['result']; expected: string; observed: string; domain: string | null }; evidenceHash: string; now: Date }): EmailVerification {
  const { facts, placedAt } = i, e = i.expected, dkimResult = i.dkim.result;
  const check = (id: string, expected: string, observed: string | null, ok: boolean): Criterion =>
    ({ id, expected, observed, result: observed === null ? 'UNKNOWN' : ok ? 'PASS' : 'FAIL' });
  const same = (id: string, expected: string, observed: string | null) =>
    check(id, expected, expected ? observed : null, !!expected && observed !== null && normalize(observed) === normalize(expected));
  const total = facts.total ? `${facts.total.currency} ${facts.total.minor}` : null;
  const item = facts.items.length === 1 ? facts.items[0]! : null;
  const criteria: Criterion[] = [
    check('MERCHANT', e.merchantId, i.merchant.id, e.merchantId === i.merchant.id),
    { id: 'DKIM_SIGNATURE', expected: i.dkim.expected, result: dkimResult, observed: i.dkim.observed },
    // The nonce binds the delivery recipient, so it must be in the merchant's ship-to name.
    // The nonce ties the order to this assignment, but the filler knows it, so the ship-to must also match
    // the buyer's stored recipient as far as the merchant email shows it. Empty expectations never pass.
    check('NONCE', e.nonce, facts.recipientName === null || !e.nonce ? null : hasToken(facts.recipientName, e.nonce) ? e.nonce : 'absent',
      !!e.nonce && !!facts.recipientName && hasToken(facts.recipientName, e.nonce)),
    // Full-name merchants: exact match. First-word merchants (Amazon.in): the visible word must be exactly the
    // first word of "<nonce> <name>", i.e. the nonce; the buyer's name itself is not visible there (documented limit).
    check('RECIPIENT_NAME', i.merchant.nameDisplay === 'firstWord' ? e.recipientName.split(' ')[0] ?? '' : e.recipientName,
      e.recipientName ? facts.recipientName : null, !!e.recipientName && facts.recipientName !== null &&
      (i.merchant.nameDisplay === 'firstWord' ? normalize(facts.recipientName) === normalize(e.recipientName.split(' ')[0] ?? '')
        : normalize(facts.recipientName) === normalize(e.recipientName))),
    same('RECIPIENT_CITY', e.recipientCity, facts.recipientCity),
    same('RECIPIENT_REGION', e.recipientRegion, facts.recipientRegion),
    // Exactly one purchased line, and it must be the accepted item exactly (no substring: "X (Pack of 24)" ≠ "X").
    check('ITEM', e.itemMatch, item ? item.name : facts.items.length ? `${facts.items.length} item lines` : null,
      !!item && normalize(item.name) === normalize(e.itemMatch)),
    check('QUANTITY', String(e.quantity), item ? String(item.quantity) : null, item?.quantity === e.quantity),
    check('TOTAL', `${e.currency} ${e.totalMinor}`, total, total === `${e.currency} ${e.totalMinor}`),
    check('MERCHANT_ORDER_ID', e.merchantOrderId ?? 'present', facts.merchantOrderId,
      e.merchantOrderId === undefined || facts.merchantOrderId === e.merchantOrderId),
    // A missing bound (e.g. funding time not yet recorded) is UNKNOWN, not a pass or a fail.
    check('PLACED_AFTER_FUNDING', e.fundedAt, placedAt && !Number.isNaN(Date.parse(e.fundedAt)) ? placedAt.toISOString() : null,
      // RFC 5322 Date has whole-second precision; compare at that precision (funding time is in ms).
      !!placedAt && placedAt.getTime() >= Math.floor(Date.parse(e.fundedAt) / 1000) * 1000),
    check('PLACED_BEFORE_DEADLINE', e.purchaseDeadline,
      placedAt && !Number.isNaN(Date.parse(e.purchaseDeadline)) ? placedAt.toISOString() : null,
      !!placedAt && placedAt.getTime() <= Date.parse(e.purchaseDeadline)),
  ];
  return {
    verdict: criteria.some(c => c.result === 'FAIL') ? 'FAIL' : criteria.some(c => c.result === 'UNKNOWN') ? 'INCONCLUSIVE' : 'PASS',
    criteria,
    reasonCodes: criteria.filter(c => c.result !== 'PASS').map(c => `${c.id}_${c.result}`),
    merchantOrderId: facts.merchantOrderId,
    evidenceHash: i.evidenceHash,
    dkimDomain: i.dkim.domain,
    observedAt: i.now.toISOString(),
  };
}
