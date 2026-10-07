import type { DkimKeyResolver } from './index.js';

const NAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i;

// DKIM public keys via DNS-over-HTTPS (JSON API, e.g. Cloudflare or Google). The endpoint is
// fixed configuration; only the looked-up name varies. Returns null when the key does not exist.
export function dohResolver(endpoint = process.env.DKIM_DOH_URL ?? 'https://cloudflare-dns.com/dns-query',
  fetcher: typeof fetch = fetch): DkimKeyResolver {
  return async (domain, selector) => {
    if (!NAME.test(domain) || !NAME.test(selector)) throw new Error('Invalid DKIM lookup name');
    const url = new URL(endpoint);
    url.searchParams.set('name', `${selector}._domainkey.${domain}`);
    url.searchParams.set('type', 'TXT');
    const response = await fetcher(url, {
      headers: { accept: 'application/dns-json' }, redirect: 'error', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`DoH HTTP ${response.status}`);
    const body = await response.json() as { Status: number; Answer?: { type: number; data: string }[] };
    if (body.Status === 3) return null; // NXDOMAIN
    if (body.Status !== 0) throw new Error(`DoH status ${body.Status}`);
    const txt = body.Answer?.find(answer => answer.type === 16);
    return txt ? [...txt.data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(chunk => chunk[1]).join('') : null;
  };
}
