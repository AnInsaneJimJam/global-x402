// Dependency-free DKIM (rsa-sha256) verification and email text extraction, with no Node APIs, so the same
// code runs inside a Chainlink CRE workflow (WASM). Covers what order-confirmation emails use: rsa-sha256,
// relaxed/simple canonicalization, multipart text parts, quoted-printable/base64. Anything else → fail/unknown.

// ---- SHA-256 ----
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
  0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
  0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length, total = ((len + 9 + 63) >> 6) << 6, buf = new Uint8Array(total);
  buf.set(data); buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(len / 0x20000000)); view.setUint32(total - 4, (len << 3) >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!);
  return out;
}

// ---- encoding helpers ----
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, ''), out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]!) << 18) | (B64.indexOf(clean[i + 1]!) << 12) |
      ((clean[i + 2] ? B64.indexOf(clean[i + 2]!) : 0) << 6) | (clean[i + 3] ? B64.indexOf(clean[i + 3]!) : 0);
    out.push((n >> 16) & 255); if (clean[i + 2]) out.push((n >> 8) & 255); if (clean[i + 3]) out.push(n & 255);
  }
  return Uint8Array.from(out);
}
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? B64[n & 63]! : '=');
  }
  return out;
}
const latin1 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s; };
const bytesOf = (text: string) => Uint8Array.from(text, c => c.charCodeAt(0) & 255);
export const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
function utf8(bytes: Uint8Array): string {
  let s = '', i = 0;
  while (i < bytes.length) {
    const b = bytes[i++]!;
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 31) << 6) | (bytes[i++]! & 63));
    else if (b < 0xf0) s += String.fromCharCode(((b & 15) << 12) | ((bytes[i++]! & 63) << 6) | (bytes[i++]! & 63));
    else { const cp = ((b & 7) << 18) | ((bytes[i++]! & 63) << 12) | ((bytes[i++]! & 63) << 6) | (bytes[i++]! & 63); s += String.fromCodePoint(cp); }
  }
  return s;
}

// ---- RSA PKCS#1 v1.5 / SHA-256 ----
function readDer(bytes: Uint8Array, at: number) {
  let len = bytes[at + 1]!, off = at + 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + bytes[off + i]!; off += n; }
  return { start: off, end: off + len };
}
function rsaKey(spki: Uint8Array) {
  const info = readDer(spki, 0);                    // SubjectPublicKeyInfo
  const algo = readDer(spki, info.start);           // AlgorithmIdentifier
  const bits = readDer(spki, algo.end);             // BIT STRING
  const rsa = readDer(spki, bits.start + 1);        // RSAPublicKey (skip unused-bits byte)
  const n = readDer(spki, rsa.start), e = readDer(spki, n.end);
  const nBytes = spki.subarray(n.start, n.end), lead = nBytes[0] === 0 ? 1 : 0;
  return { n: BigInt('0x' + toHex(nBytes)), e: BigInt('0x' + toHex(spki.subarray(e.start, e.end))), bytes: nBytes.length - lead };
}
function modPow(base: bigint, exp: bigint, mod: bigint) {
  let result = 1n; base %= mod;
  while (exp > 0n) { if (exp & 1n) result = (result * base) % mod; base = (base * base) % mod; exp >>= 1n; }
  return result;
}
const DIGEST_INFO = '3031300d060960864801650304020105000420';
function rsaVerify(spki: Uint8Array, signature: Uint8Array, digest: Uint8Array) {
  const key = rsaKey(spki);
  if (key.bytes < 128) return false;                // reject keys under 1024 bits
  const em = modPow(BigInt('0x' + (toHex(signature) || '0')), key.e, key.n).toString(16).padStart(key.bytes * 2, '0');
  const tail = `00${DIGEST_INFO}${toHex(digest)}`;
  return em === `0001${'f'.repeat(key.bytes * 2 - 4 - tail.length)}${tail}`;
}

// ---- message parsing & DKIM ----
export type Header = { name: string; raw: string };
export function splitMessage(raw: Uint8Array) {
  const text = latin1(raw).replace(/\r?\n/g, '\r\n');
  const cut = text.indexOf('\r\n\r\n');
  const head = cut === -1 ? text : text.slice(0, cut + 2), body = cut === -1 ? '' : text.slice(cut + 4);
  const headers: Header[] = [];
  for (const line of head.split(/(?<=\r\n)/)) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1]!.raw += line;
    else if (line.trim()) headers.push({ name: line.slice(0, line.indexOf(':')).trim().toLowerCase(), raw: line });
  }
  return { headers, body };
}
const tags = (value: string) => Object.fromEntries(value.split(';').map(part => part.trim()).filter(Boolean)
  .map(part => [part.slice(0, part.indexOf('=')).trim(), part.slice(part.indexOf('=') + 1).replace(/\s+/g, '')]));
const relaxedHeader = (raw: string) => {
  const colon = raw.indexOf(':');
  return `${raw.slice(0, colon).trim().toLowerCase()}:${raw.slice(colon + 1).replace(/\r\n/g, '').replace(/[ \t]+/g, ' ').trim()}`;
};
function canonBody(body: string, mode: string) {
  let text = mode === 'relaxed' ? body.split('\r\n').map(line => line.replace(/[ \t]+/g, ' ').replace(/ $/, '')).join('\r\n') : body;
  text = text.replace(/(\r\n)*$/, '');
  return text.length || mode === 'simple' ? `${text}\r\n` : '';
}
export type DkimOutcome = { result: 'pass' | 'fail' | 'unknown'; domain: string | null; reason: string; signedHeaders: string[] };
// Verifies a signature from an allowed domain. resolveKey returns the DKIM TXT record, or null when missing/revoked.
export async function verifyDkim(raw: Uint8Array, allowed: readonly string[],
  resolveKey: (domain: string, selector: string) => Promise<string | null>): Promise<DkimOutcome> {
  const { headers, body } = splitMessage(raw);
  let outcome: DkimOutcome = { result: 'fail', domain: null, reason: 'no signature from an allowed domain', signedHeaders: [] };
  for (const sig of headers.filter(h => h.name === 'dkim-signature')) {
    const t = tags(sig.raw.slice(sig.raw.indexOf(':') + 1));
    const domain = (t.d ?? '').toLowerCase();
    if (!allowed.includes(domain)) continue;
    const [hc = 'simple', bc = 'simple'] = (t.c ?? 'simple/simple').split('/');
    const signed = (t.h ?? '').toLowerCase().split(':').filter(Boolean);
    // The headers we read must be signed and unambiguous (DKIM signs the last copy; a parser may read the first).
    const count = (name: string) => headers.filter(h => h.name === name).length;
    const mustSign = ['from', 'date', 'subject', ...(count('content-type') ? ['content-type'] : [])];
    if (!mustSign.every(name => signed.includes(name)) || ['from', 'date', 'subject'].some(name => count(name) !== 1) ||
      ['content-type', 'content-transfer-encoding'].some(name => count(name) > 1)) {
      outcome = { result: 'fail', domain, reason: 'required headers unsigned or duplicated', signedHeaders: signed }; continue;
    }
    if (t.a !== 'rsa-sha256' || t.l !== undefined) { outcome = { result: 'fail', domain, reason: 'unsupported algorithm or body length limit', signedHeaders: signed }; continue; }
    if (toBase64(sha256(bytesOf(canonBody(body, bc)))) !== t.bh) { outcome = { result: 'fail', domain, reason: 'body hash mismatch', signedHeaders: signed }; continue; }
    const record = await resolveKey(domain, t.s ?? '').catch(() => null);
    const p = record ? tags(record).p : undefined;
    if (!p) { outcome = { result: 'unknown', domain, reason: 'key missing or revoked', signedHeaders: signed }; continue; }
    const used = new Map<string, number>(); let input = '';
    for (const name of signed) {
      const all = headers.filter(h => h.name === name), n = used.get(name) ?? 0;
      const chosen = all[all.length - 1 - n]; used.set(name, n + 1);
      if (chosen) input += hc === 'relaxed' ? `${relaxedHeader(chosen.raw)}\r\n` : chosen.raw;
    }
    const sigBlank = sig.raw.replace(/(\bb=)[^;]*/, '$1').replace(/\r\n$/, '');
    input += hc === 'relaxed' ? relaxedHeader(sigBlank) : sigBlank;
    if (rsaVerify(fromBase64(p), fromBase64(t.b ?? ''), sha256(bytesOf(input)))) return { result: 'pass', domain, reason: 'signature valid', signedHeaders: signed };
    outcome = { result: 'fail', domain, reason: 'signature invalid', signedHeaders: signed };
  }
  return outcome;
}

// ---- text extraction (first text/plain part) ----
function decodePart(headers: Header[], body: string): string {
  const enc = headers.find(h => h.name === 'content-transfer-encoding')?.raw.split(':')[1]?.trim().toLowerCase() ?? '7bit';
  const bytes = enc === 'base64' ? fromBase64(body)
    : enc === 'quoted-printable' ? bytesOf(body.replace(/=\r\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, x: string) => String.fromCharCode(parseInt(x, 16))))
    : bytesOf(body);
  return utf8(bytes);
}
export function textPart(raw: Uint8Array): string {
  const walk = (headers: Header[], body: string): string | null => {
    // Ambiguous MIME headers at any level: refuse rather than pick one.
    if (['content-type', 'content-transfer-encoding'].some(name => headers.filter(h => h.name === name).length > 1)) return null;
    const type = headers.find(h => h.name === 'content-type')?.raw ?? 'content-type: text/plain';
    const boundary = /boundary="?([^";\r\n]+)"?/i.exec(type)?.[1];
    if (/multipart\//i.test(type) && boundary) {
      for (const part of body.split(`--${boundary}`).slice(1)) {
        if (part.startsWith('--')) break;
        const inner = splitMessage(bytesOf(part.replace(/^\r\n/, '')));
        const found = walk(inner.headers, inner.body);
        if (found !== null) return found;
      }
      return null;
    }
    return /text\/plain/i.test(type) ? decodePart(headers, body) : null;
  };
  const { headers, body } = splitMessage(raw);
  return (walk(headers, body) ?? '').replace(/\r\n/g, '\n');
}
// Value of a header that appears exactly once (duplicates are rejected by the caller as unsafe).
export function singleHeader(raw: Uint8Array, name: string): string | null {
  const found = splitMessage(raw).headers.filter(h => h.name === name);
  return found.length === 1 ? found[0]!.raw.slice(found[0]!.raw.indexOf(':') + 1).replace(/\r\n/g, '').trim() : null;
}
