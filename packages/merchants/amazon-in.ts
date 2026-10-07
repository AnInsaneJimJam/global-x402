import type { MerchantConfig } from './index.js';
import { toMinor } from './index.js';

// Amazon.in "Ordered: …" confirmation, text/plain part (layout observed 2026-01 on a real email).
// Ship-to line: "<Name> – <CITY>, <STATE>"; then "Order #" / id; "* <title>" / "Quantity: n" / price;
// "Total" / "<amount> INR". Parsed line by line on trimmed non-empty lines.
export const amazonIn: MerchantConfig = {
  id: 'amazon-in',
  dkimDomains: ['amazon.in'],
  extract(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const after = (label: string) => lines.flatMap((line, n) => line === label && lines[n + 1] ? [lines[n + 1]!] : []);
    const orderIds = after('Order #').filter(line => /^\d{3}-\d{7}-\d{7}$/.test(line));
    const totals = after('Total').map(line => /^([\d,]+(?:\.\d{1,2})?) INR$/.exec(line)).filter(m => m !== null);
    // Item titles can also contain " – " and commas, so item lines ("* …") are excluded.
    const shipTo = lines.filter(line => !line.startsWith('* ')).map(line => /^(.+?) – [^,]+, .+$/.exec(line))
      .filter(m => m !== null);
    return {
      merchantOrderId: orderIds.length === 1 ? orderIds[0]! : null,
      items: lines.flatMap((line, n) => {
        const quantity = /^Quantity: (\d+)$/.exec(lines[n + 1] ?? '');
        return line.startsWith('* ') && quantity ? [{ name: line.slice(2), quantity: Number(quantity[1]) }] : [];
      }),
      recipientName: shipTo.length === 1 ? shipTo[0]![1]! : null,
      total: totals.length === 1 ? { currency: 'INR', minor: toMinor(totals[0]![1]!) } : null,
    };
  },
};
