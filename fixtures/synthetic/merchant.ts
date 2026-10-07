import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth/lib/dkim/sign.js';
import type { MerchantConfig } from '../../packages/merchants/index.js';
import { toMinor } from '../../packages/merchants/index.js';

// Synthetic merchant used only by tests. Not an Amazon format.
export const fixtureMerchant: MerchantConfig = {
  id: 'fixture-merchant',
  dkimDomains: ['shop.example'],
  extract(text) {
    const totals = [...text.matchAll(/^Order Total: ([A-Z]{3}) ([\d,]+\.\d{2})$/gm)];
    const shipTo = [...text.matchAll(/^Ship to: ([^,\n]+),/gm)];
    return {
      merchantOrderId: /^Order #: (\S+)$/m.exec(text)?.[1] ?? null,
      items: [...text.matchAll(/^Item: (.+) x (\d+)$/gm)].map(m => ({ name: m[1]!, quantity: Number(m[2]) })),
      recipientName: shipTo.length === 1 ? shipTo[0]![1]! : null,
      total: totals.length === 1 ? { currency: totals[0]![1]!, minor: toMinor(totals[0]![2]!) } : null,
    };
  },
};

export const expected = {
  orderId: 'order-1', claimId: 'claim-1', termsHash: 'a'.repeat(64), nonce: 'GOB-7F3K',
  merchantId: 'fixture-merchant', itemMatch: 'Coca-Cola Original 330ml', quantity: 1,
  totalMinor: '5000', currency: 'INR',
  fundedAt: '2026-10-07T09:00:00Z', purchaseDeadline: '2026-10-07T12:00:00Z',
};

export function orderEmail(overrides: Partial<{ from: string; date: string; body: string; nonce: string;
  orderNo: string; total: string }> = {}) {
  const nonce = overrides.nonce ?? 'GOB-7F3K';
  const body = overrides.body ?? [
    `Hello Alice Doe ${nonce},`,
    'Your order has been placed.',
    `Order #: ${overrides.orderNo ?? '403-1234567-7654321'}`,
    'Item: Coca-Cola Original 330ml x 1',
    `Order Total: ${overrides.total ?? 'INR 50.00'}`,
    `Ship to: Alice Doe ${nonce}, Synthetic Street, Demo City`,
  ].join('\r\n');
  return [
    `From: Orders <${overrides.from ?? 'orders@shop.example'}>`,
    'To: filler@example.net',
    'Subject: Your order has been placed',
    `Date: ${overrides.date ?? 'Wed, 07 Oct 2026 10:00:00 +0000'}`,
    'Message-ID: <synthetic-1@shop.example>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
  ].join('\r\n');
}

// Throwaway signing key generated per test run; the matching DNS record is served by a stub resolver.
export function testKey() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const record = `v=DKIM1; k=rsa; p=${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`;
  return { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), record };
}

export async function sign(message: string, privateKey: string,
  options: { signingDomain?: string; maxBodyLength?: number } = {}) {
  const signature = { signingDomain: options.signingDomain ?? 'shop.example', selector: 'sel1', privateKey,
    ...(options.maxBodyLength === undefined ? {} : { maxBodyLength: options.maxBodyLength }) };
  const { signatures } = await dkimSign(message, { ...signature, signatureData: [signature] });
  return Buffer.from(signatures + message);
}
