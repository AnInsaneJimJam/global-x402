import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

if (process.env.VERIFIER === 'CRE') {
  const origin = new URL(process.env.CRE_API_URL ?? '');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('CRE_API_URL must be an HTTP(S) API origin');
  if (!process.env.CRE_API_KEY) throw new Error('Set CRE_API_KEY for hosted headless CRE authentication');
  const token = process.env.CRE_VERIFIER_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error('Set a strong base64url CRE_VERIFIER_TOKEN');
  process.env.CRE_ENV_FILE = '/tmp/ex402-cre.env';
  await writeFile(process.env.CRE_ENV_FILE, `CRE_VERIFIER_TOKEN=${token}\n`, { mode: 0o600 });
  await writeFile('workflows/cre-verify/verify-order/config.staging.json', JSON.stringify({
    apiUrl: origin.origin, dohUrl: 'https://cloudflare-dns.com/dns-query',
  }));
}
const worker = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/main.ts'], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => worker.kill(signal));
worker.on('error', () => { console.error('Worker process could not start'); process.exit(1); });
worker.on('exit', (code) => process.exit(code ?? 1));
