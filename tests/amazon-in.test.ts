import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amazonIn } from '../packages/merchants/amazon-in.js';
import { toMinor } from '../packages/merchants/index.js';
import { verifyOrderEmail } from '../packages/verification/index.js';
import { sign, testKey } from '../fixtures/synthetic/merchant.js';

// Synthetic text laid out like a real Amazon.in "Ordered:" confirmation (blank lines, indentation).
const ITEM = 'Coca-Cola Original Taste Soft Drink Can, 300 ml';
const text = (lines: Partial<{ item: string; extra: string; shipTo: string; total: string }> = {}) => [
  '', '  ', '', '    Thanks for your order, Alice!', 'Ordered', '', 'Shipped', '', 'Out for delivery', '', 'Delivered',
  '', '', '', 'Arriving Monday', '', '', '', lines.shipTo ?? 'GOB-7F3K – DEMO CITY, DEMO STATE', '',
  'Order #', '403-1234567-7654321', '', 'View or edit order',
  'https://www.amazon.in/your-orders/order-details?orderID=403-1234567-7654321', '',
  `* ${lines.item ?? ITEM}`, '  Quantity: 1', '  40 INR', '', lines.extra ?? '', '',
  'Total', lines.total ?? '50 INR', '', '', '©2026 Amazon.com, Inc. or its affiliates. All rights reserved.', '', 'Amazon.in',
].join('\n');
const expected = { orderId: 'o', claimId: 'c', termsHash: 'a'.repeat(64), nonce: 'GOB-7F3K', merchantId: 'amazon-in',
  recipientName: 'GOB-7F3K Alice Doe', recipientCity: 'Demo City', recipientRegion: 'Demo State',
  itemMatch: ITEM, quantity: 1, totalMinor: '5000', currency: 'INR',
  fundedAt: '2026-10-07T09:00:00Z', purchaseDeadline: '2026-10-07T12:00:00Z' };
const message = (body = text()) => ['From: "Amazon.in" <order-update@amazon.in>', 'To: filler@example.net',
  'Subject: Ordered: "Coca-Cola Original Taste..."', 'Date: Wed, 07 Oct 2026 10:00:00 +0000',
  'Message-ID: <synthetic-2@amazon.in>', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '',
  body.replaceAll('\n', '\r\n'), ''].join('\r\n');

test('extracts order id, single item, ship-to name and total from Amazon.in layout', () => {
  assert.deepEqual(amazonIn.extract(text()), {
    merchantOrderId: '403-1234567-7654321',
    items: [{ name: ITEM, quantity: 1 }],
    recipientName: 'GOB-7F3K',
    recipientCity: 'DEMO CITY',
    recipientRegion: 'DEMO STATE',
    total: { currency: 'INR', minor: '5000' },
  });
});

test('nonce in the name does not help if the order ships elsewhere or the name differs', async () => {
  const key = testKey();
  const run = (shipTo: string) => sign(message(text({ shipTo })), key.privateKey, { signingDomain: 'amazon.in' })
    .then(raw => verifyOrderEmail({ raw, expected, merchant: amazonIn, resolveDkimKey: async () => key.record,
      now: new Date('2026-10-07T10:05:00Z') }));
  const failed = async (shipTo: string) => (await run(shipTo)).criteria.filter(c => c.result === 'FAIL').map(c => c.id);
  assert.deepEqual(await failed('GOB-7F3K – OTHER CITY, DEMO STATE'), ['RECIPIENT_CITY']);
  assert.deepEqual(await failed('Mallory GOB-7F3K – DEMO CITY, DEMO STATE'), ['RECIPIENT_NAME']);
  assert.ok((await failed('GOB-7F3KX – DEMO CITY, DEMO STATE')).includes('NONCE'));
  // A second "– CITY, STATE" smuggled into the typed name makes the line unparseable, never a pass.
  const smuggled = await run('GOB-7F3K – DEMO CITY, DEMO STATE – OTHER CITY, OTHER STATE');
  assert.notEqual(smuggled.verdict, 'PASS');
  assert.equal(smuggled.criteria.find(c => c.id === 'RECIPIENT_CITY')?.result, 'UNKNOWN');
});

test('second item line is extracted so verification can reject it; ambiguous total is null', () => {
  assert.equal(amazonIn.extract(text({ extra: '* Pepsi 300 ml\n  Quantity: 1\n  40 INR' })).items.length, 2);
  assert.equal(amazonIn.extract(text({ extra: 'Total\n10 INR' })).total, null);
});

test('ship-to is read only from its position before "Order #", not from elsewhere in the body', () => {
  // Real ship-to line does not match the pattern; a planted matching line further down must not be used.
  const planted = text({ shipTo: 'Mallory', extra: 'GOB-7F3K – DEMO CITY, DEMO STATE' });
  assert.equal(amazonIn.extract(planted).recipientName, null);
});

test('amounts accept rupees without decimals and Indian digit grouping', () => {
  assert.equal(toMinor('2009'), '200900');
  assert.equal(toMinor('1,00,000.50'), '10000050');
  assert.equal(toMinor('49.5'), '4950');
});

test('signed Amazon.in-style email passes end to end with the amazon-in config', async () => {
  const key = testKey();
  const result = await verifyOrderEmail({ raw: await sign(message(), key.privateKey, { signingDomain: 'amazon.in' }),
    expected, merchant: amazonIn, resolveDkimKey: async () => key.record, now: new Date('2026-10-07T10:05:00Z') });
  assert.equal(result.verdict, 'PASS', JSON.stringify(result.criteria));
});

test('revoked merchant key (empty p=) is INCONCLUSIVE, not FAIL', async () => {
  const key = testKey();
  const result = await verifyOrderEmail({ raw: await sign(message(), key.privateKey, { signingDomain: 'amazon.in' }),
    expected, merchant: amazonIn, resolveDkimKey: async () => 'p=', now: new Date('2026-10-07T10:05:00Z') });
  assert.equal(result.verdict, 'INCONCLUSIVE', JSON.stringify(result.criteria));
});
