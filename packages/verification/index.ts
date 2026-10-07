import { createHash } from 'node:crypto';
import { dkimVerify } from 'mailauth/lib/dkim/verify.js';
import { simpleParser } from 'mailparser';
import type { ExtractedOrder, MerchantConfig } from '../merchants/index.js';

export type ExpectedOrder = {
  orderId: string; claimId: string; termsHash: string; nonce: string; merchantId: string;
  itemMatch: string; quantity: number; totalMinor: string; currency: string;
  fundedAt: string; purchaseDeadline: string;
};
export type DkimKeyResolver = (domain: string, selector: string) => Promise<string | null>;
export type Criterion = { id: string; expected: string; observed: string | null; result: 'PASS' | 'FAIL' | 'UNKNOWN' };
export type EmailVerification = {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; criteria: Criterion[]; reasonCodes: string[];
  merchantOrderId: string | null; evidenceHash: string; dkimDomain: string | null; observedAt: string;
};

// Headers that must be covered by the signature so the facts we read cannot be swapped.
const SIGNED_HEADERS = ['from', 'date', 'subject'];
function noKey(): never { throw Object.assign(new Error('no key'), { code: 'ENOTFOUND' }); }

// Pure check of an order-confirmation email against the accepted order. No signing authority,
// no database. Email content is data only: it is matched, never interpreted as instructions.
export async function verifyOrderEmail(i: {
  raw: Uint8Array; expected: ExpectedOrder; merchant: MerchantConfig; resolveDkimKey: DkimKeyResolver; now: Date;
}): Promise<EmailVerification> {
  const raw = Buffer.from(i.raw);
  const allowed = new Set(i.merchant.dkimDomains.map(domain => domain.toLowerCase()));
  // Only the merchant's own domains are looked up; other signatures in the email cause no network calls.
  const resolver = async (name: string, rrtype: string) => {
    const match = /^(.+)\._domainkey\.(.+)$/.exec(name.toLowerCase());
    if (rrtype !== 'TXT' || !match || !allowed.has(match[2]!)) noKey();
    const record = await i.resolveDkimKey(match[2]!, match[1]!);
    return record === null ? noKey() : [[record]];
  };
  const dkim = await dkimVerify(raw, { resolver });
  const fromDomain = dkim.fromFields === 1 ? dkim.headerFrom[0]?.split('@').pop()?.toLowerCase() ?? null : null;
  const ours = dkim.results.filter(r => allowed.has(r.signingDomain?.toLowerCase() ?? ''));
  const valid = ours.find(r => r.status.result === 'pass' && !r.canonBodyLengthLimited &&
    SIGNED_HEADERS.every(header => (r.signingHeaders?.keys ?? '').toLowerCase().split(/[:\s]+/).includes(header)));
  const transient = ours.some(r => r.status.result === 'temperror' || r.status.comment === 'no key');
  // DKIM covers the last copy of a header while the MIME parser may read the first, so an unsigned
  // duplicate (e.g. a forged Date on an old genuine email) must not survive.
  const count = (name: string) => dkim.headers?.parsed.filter(h => h.key === name).length ?? 0;
  const singleHeaders = SIGNED_HEADERS.every(name => count(name) === 1) &&
    ['content-type', 'content-transfer-encoding'].every(name => count(name) <= 1);
  const dkimResult = valid && singleHeaders && fromDomain && allowed.has(fromDomain) ? 'PASS' :
    !valid && transient ? 'UNKNOWN' : 'FAIL';

  const mail = await simpleParser(raw);
  const text = mail.text ?? '';
  let facts: ExtractedOrder = { merchantOrderId: null, items: [], recipientName: null, total: null };
  try { facts = i.merchant.extract(text); } catch { /* unrecognised layout leaves facts UNKNOWN */ }
  const placedAt = mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date : null;
  const e = i.expected;
  const check = (id: string, expected: string, observed: string | null, ok: boolean): Criterion =>
    ({ id, expected, observed, result: observed === null ? 'UNKNOWN' : ok ? 'PASS' : 'FAIL' });
  const total = facts.total ? `${facts.total.currency} ${facts.total.minor}` : null;
  const item = facts.items.length === 1 ? facts.items[0]! : null;
  const criteria: Criterion[] = [
    check('MERCHANT', e.merchantId, i.merchant.id, e.merchantId === i.merchant.id),
    { id: 'DKIM_SIGNATURE', expected: [...allowed].join('|'), result: dkimResult,
      observed: valid?.signingDomain ?? (ours[0] ? `${ours[0].signingDomain}: ${ours[0].status.result}` : 'no merchant signature') },
    // The nonce binds the delivery recipient, so it must be in the merchant's ship-to name.
    check('NONCE', e.nonce, facts.recipientName === null ? null : facts.recipientName.includes(e.nonce) ? e.nonce : 'absent',
      !!facts.recipientName?.includes(e.nonce)),
    // Exactly one purchased line, and it must be the accepted item.
    check('ITEM', e.itemMatch, item ? item.name : facts.items.length ? `${facts.items.length} item lines` : null,
      !!item?.name.toLowerCase().includes(e.itemMatch.toLowerCase())),
    check('QUANTITY', String(e.quantity), item ? String(item.quantity) : null, item?.quantity === e.quantity),
    check('TOTAL', `${e.currency} ${e.totalMinor}`, total, total === `${e.currency} ${e.totalMinor}`),
    check('MERCHANT_ORDER_ID', 'present', facts.merchantOrderId, true),
    check('PLACED_AFTER_FUNDING', e.fundedAt, placedAt?.toISOString() ?? null,
      !!placedAt && placedAt.getTime() >= Date.parse(e.fundedAt)),
    check('PLACED_BEFORE_DEADLINE', e.purchaseDeadline, placedAt?.toISOString() ?? null,
      !!placedAt && placedAt.getTime() <= Date.parse(e.purchaseDeadline)),
  ];
  return {
    verdict: criteria.some(c => c.result === 'FAIL') ? 'FAIL' : criteria.some(c => c.result === 'UNKNOWN') ? 'INCONCLUSIVE' : 'PASS',
    criteria,
    reasonCodes: criteria.filter(c => c.result !== 'PASS').map(c => `${c.id}_${c.result}`),
    merchantOrderId: facts.merchantOrderId,
    evidenceHash: createHash('sha256').update(raw).digest('hex'),
    dkimDomain: valid?.signingDomain ?? null,
    observedAt: i.now.toISOString(),
  };
}
