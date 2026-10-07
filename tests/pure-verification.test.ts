import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256, textPart, verifyDkim } from '../packages/verification/pure.js';
import { amazonIn } from '../packages/merchants/amazon-in.js';
import { orderEmail, sign, testKey } from '../fixtures/synthetic/merchant.js';

const key = testKey();
const resolve = async () => key.record;

test('pure sha256 matches node crypto', () => {
  for (const input of ['', 'abc', 'x'.repeat(1000)]) {
    assert.equal(Buffer.from(sha256(Buffer.from(input))).toString('hex'), createHash('sha256').update(input).digest('hex'));
  }
});

test('pure DKIM: valid passes, tampered fails, revoked key is unknown, foreign domain fails', async () => {
  const good = await sign(orderEmail(), key.privateKey);
  assert.equal((await verifyDkim(good, ['shop.example'], resolve)).result, 'pass');
  assert.equal((await verifyDkim(Buffer.from(good.toString().replace('INR 50.00', 'INR 05.00')), ['shop.example'], resolve)).result, 'fail');
  assert.equal((await verifyDkim(good, ['shop.example'], async () => 'p=')).result, 'unknown');
  assert.equal((await verifyDkim(good, ['other.example'], resolve)).result, 'fail');
});

test('pure DKIM: duplicated or unsigned security headers are refused', async () => {
  const good = await sign(orderEmail(), key.privateKey);
  for (const prefix of ['Content-Type: text/html\r\n', 'Date: Wed, 07 Oct 2026 08:00:00 +0000\r\n']) {
    const raw = Buffer.concat([Buffer.from(prefix), good]);
    assert.equal((await verifyDkim(raw, ['shop.example'], resolve)).result, 'fail');
  }
  assert.equal(textPart(Buffer.concat([Buffer.from('Content-Type: text/html\r\n'), good])), '');
});

test('pure text extraction feeds the Amazon.in parser', () => {
  const body = ['GOB-7F3K – DEMO CITY, DEMO STATE', 'Order #', '403-1234567-7654321', '* Coca-Cola Original 330ml', 'Quantity: 1', 'Total', '50 INR'].join('\r\n');
  const raw = Buffer.from(['From: a@amazon.in', 'Subject: s', 'Date: Wed, 07 Oct 2026 10:00:00 +0000', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable', '', body.replace('–', '=E2=80=93'), '--b1--', ''].join('\r\n'));
  const facts = amazonIn.extract(textPart(raw));
  assert.equal(facts.recipientName, 'GOB-7F3K');
  assert.equal(facts.total?.minor, '5000');
});
