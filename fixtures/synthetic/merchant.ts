import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth/lib/dkim/sign.js';
import type { MerchantConfig } from '../../packages/merchants/index.js';
import { toMinor } from '../../packages/merchants/index.js';

// Synthetic merchant used only by tests. Not an Amazon format.
export const fixtureMerchant: MerchantConfig = {
  id: 'fixture-merchant',
  dkimDomains: ['shop.example'],
  extract(text) {
    const total = /Order Total: ([A-Z]{3}) ([\d,]+\.\d{2})/.exec(text);
    const quantity = /Quantity: (\d+)/.exec(text);
    return {
      merchantOrderId: /Order #: (\S+)/.exec(text)?.[1] ?? null,
      quantity: quantity ? Number(quantity[1]) : null,
      total: total ? { currency: total[1]!, minor: toMinor(total[2]!) } : null,
    };
  },
};

export const expected = {
  orderId: 'order-1', claimId: 'claim-1', termsHash: 'a'.repeat(64), nonce: 'GOB-7F3K',
  merchantId: 'fixture-merchant', itemMatch: 'Coca-Cola Original 330ml', quantity: 1,
  totalMinor: '5000', currency: 'INR',
  fundedAt: '2026-10-07T09:00:00Z', purchaseDeadline: '2026-10-07T12:00:00Z',
};

export function orderEmail(overrides: Partial<{ from: string; date: string; body: string }> = {}) {
  const body = overrides.body ?? [
    'Hello Alice Doe GOB-7F3K,',
    'Your order has been placed.',
    'Order #: 403-1234567-7654321',
    'Item: Coca-Cola Original 330ml',
    'Quantity: 1',
    'Order Total: INR 50.00',
    'Ship to: Alice Doe GOB-7F3K, Synthetic Street, Demo City',
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
