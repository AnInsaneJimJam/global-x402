// Local-only diagnostic for a real order-confirmation email (Track B0/B2).
// Usage: node --import tsx scripts/check-eml.ts path/to/order.eml
// Prints signature facts only — never the body, names or addresses. Keep real .eml files out of git.
import { readFile } from 'node:fs/promises';
import { dkimVerify } from 'mailauth/lib/dkim/verify.js';
import { simpleParser } from 'mailparser';
import { dohResolver } from '../packages/verification/doh.js';

const path = process.argv[2];
if (!path) throw new Error('Usage: node --import tsx scripts/check-eml.ts path/to/order.eml');
const raw = await readFile(path);
const resolve = dohResolver();
const dkim = await dkimVerify(raw, {
  resolver: async (name: string) => {
    const [selector, domain] = name.split('._domainkey.');
    const record = selector && domain ? await resolve(domain, selector) : null;
    if (record === null) throw Object.assign(new Error('no key'), { code: 'ENOTFOUND' });
    return [[record]];
  },
});
const mail = await simpleParser(raw);
console.log(JSON.stringify({
  fromDomain: dkim.headerFrom.map(address => address.split('@').pop()),
  date: mail.date?.toISOString() ?? null,
  hasTextBody: Boolean(mail.text), hasHtmlBody: Boolean(mail.html),
  signatures: dkim.results.map(r => ({
    domain: r.signingDomain, selector: r.selector, result: r.status.result, comment: r.status.comment,
    signedHeaders: r.signingHeaders?.keys, bodyLengthLimited: r.canonBodyLengthLimited,
  })),
}, null, 2));
