import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (process.env.VERIFIER === 'CRE') {
  const origin = new URL(process.env.CRE_API_URL ?? '');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('CRE_API_URL must be an HTTP(S) API origin');
  if (!process.env.CRE_API_KEY) {
    // Browser login works for simulation without requesting network deploy access.
    // Transfer the session privately; never bake it into the image or print it.
    const directory = join(homedir(), '.cre');
    const files = [['CRE_SESSION_YAML_B64', 'cre.yaml'], ['CRE_CONTEXT_YAML_B64', 'context.yaml']];
    const decoded = files.map(([variable, file]) => {
      const encoded = process.env[variable];
      if (!encoded || encoded.length > 174764 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        throw new Error('Configure a CRE API key or both private browser-session files for simulation');
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.toString('base64') !== encoded)
        throw new Error('CRE browser-session files must be canonical base64');
      return { variable, file, bytes };
    });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const { variable, file, bytes } of decoded) {
      await writeFile(join(directory, file), bytes, { mode: 0o600 });
      delete process.env[variable];
    }
  }
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
