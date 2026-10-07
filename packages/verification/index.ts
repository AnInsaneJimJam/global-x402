import { createHash } from 'node:crypto';
import { dkimVerify } from 'mailauth/lib/dkim/verify.js';
import { simpleParser } from 'mailparser';
import type { ExtractedOrder, MerchantConfig } from '../merchants/index.js';
import { evaluate } from './criteria.js';

export type ExpectedOrder = {
  orderId: string; claimId: string; termsHash: string; nonce: string; merchantId: string;
  // Buyer's stored recipient: full ship-to name (incl. nonce), city and optional state/region.
  recipientName: string; recipientCity: string; recipientRegion: string;
  itemMatch: string; quantity: number; totalMinor: string; currency: string;
  fundedAt: string; purchaseDeadline: string;
  // Filler-declared order id; when given, the email's own order id must equal it (uniqueness is bound to it).
  merchantOrderId?: string;
};
export type DkimKeyResolver = (domain: string, selector: string) => Promise<string | null>;
export type Criterion = { id: string; expected: string; observed: string | null; result: 'PASS' | 'FAIL' | 'UNKNOWN' };
export type EmailVerification = {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; criteria: Criterion[]; reasonCodes: string[];
  merchantOrderId: string | null; evidenceHash: string; dkimDomain: string | null; observedAt: string;
};

// Headers that must be covered by the signature so the facts we read cannot be swapped.
const SIGNED_HEADERS = ['from', 'date', 'subject'];
// Raw header block up to the first empty line (CRLF or LF line endings).
function headerBlock(raw: Buffer) {
  const text = raw.toString('latin1');
  const end = text.search(/\r?\n\r?\n/);
  return end === -1 ? text : text.slice(0, end);
}
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
  // Unverifiable, not disproven: DNS failure, missing key, or a key the merchant has since revoked
  // (empty "p=" — keys rotate, so old emails stop verifying). Never PASS; goes to manual review.
  const transient = ours.some(r => r.status.result === 'temperror' ||
    ['no key', 'invalid public key'].includes(r.status.comment ?? ''));
  const mail = await simpleParser(raw);
  // Two parsers read this message (mailauth for DKIM, mailparser for the body). Any header they could
  // split differently, or an unsigned duplicate (DKIM covers the last copy, parsers may read the first),
  // could smuggle a forged value past the signature. Require a clean, identical, de-duplicated header view.
  const authHeaders = dkim.headers?.parsed ?? [];
  const head = headerBlock(raw);
  const count = (name: string) => authHeaders.filter(h => h.key === name).length;
  const consistentHeaders = !/\r(?!\n)/.test(head) && head.split(/\r?\n/).every(line => /^[\x21-\x39\x3b-\x7e \t]/.test(line)) &&
    authHeaders.length === mail.headerLines.length && authHeaders.every((h, n) => h.key === mail.headerLines[n]?.key) &&
    SIGNED_HEADERS.every(name => count(name) === 1) &&
    ['content-type', 'content-transfer-encoding'].every(name => count(name) <= 1);
  const dkimResult = valid && consistentHeaders && fromDomain && allowed.has(fromDomain) ? 'PASS' :
    !valid && transient ? 'UNKNOWN' : 'FAIL';

  const text = mail.text ?? '';
  let facts: ExtractedOrder = { merchantOrderId: null, items: [], recipientName: null, recipientCity: null, recipientRegion: null, total: null };
  try { facts = i.merchant.extract(text); } catch { /* unrecognised layout leaves facts UNKNOWN */ }
  // Date comes from the same parsed header row the signature covers, not from the second parser.
  const dateLine = authHeaders.find(h => h.key === 'date')?.line.toString('latin1');
  const parsedDate = dateLine ? new Date(dateLine.replace(/^date:/i, '').replace(/\r?\n[ \t]+/g, ' ').trim()) : null;
  const placedAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
  return evaluate({ expected: i.expected, merchant: i.merchant, facts, placedAt, now: i.now,
    evidenceHash: createHash('sha256').update(raw).digest('hex'),
    dkim: { result: dkimResult, expected: [...allowed].join('|'), domain: valid?.signingDomain ?? null,
      observed: valid?.signingDomain ?? (ours[0] ? `${ours[0].signingDomain}: ${ours[0].status.result}` : 'no merchant signature') } });
}
