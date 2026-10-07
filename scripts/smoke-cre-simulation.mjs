// Run inside the authenticated worker container. Only an isolated local fixture API is used.
import { createServer } from 'node:http';
import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'ex402-cre-smoke-'));
const token = randomBytes(32).toString('base64url');
const raw = Buffer.from('From: orders@amazon.in\r\nSubject: unsigned simulation fixture\r\n\r\nNot genuine order evidence.\r\n');
const sha256 = createHash('sha256').update(raw).digest('hex');
let verdict;
const server = createServer(async (req, res) => {
  try {
    if (req.headers['x-cre-token'] !== token) { res.writeHead(401).end(); return; }
    if (req.method === 'GET' && req.url === `/v1/internal/cre/evidence/smoke-nonpaying?sha256=${sha256}`) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ merchantId: 'amazon-in', emlBase64: raw.toString('base64'), expected: {
        orderId: 'smoke-nonpaying', claimId: 'smoke', termsHash: '0'.repeat(64), nonce: 'SMOKE', merchantId: 'amazon-in',
        recipientName: 'SMOKE Test', recipientCity: 'Test', recipientRegion: 'Test', itemMatch: 'test item', quantity: 1,
        totalMinor: 100, currency: 'INR', fundedAt: new Date().toISOString(),
        purchaseDeadline: new Date(Date.now() + 60000).toISOString(), merchantOrderId: 'test',
      } }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/internal/verification-results') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const result = JSON.parse(body);
      verdict = result.result.verdict;
      if (verdict !== 'FAIL' || result.orderId !== 'smoke-nonpaying' || result.sha256 !== sha256 || result.result.evidenceHash !== sha256) {
        res.writeHead(422).end(); return;
      }
      res.setHeader('content-type', 'application/json');
      res.end('{}');
      return;
    }
    res.writeHead(404).end();
  } catch { res.writeHead(400).end(); }
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const app = process.env.CRE_SMOKE_APP_ROOT ?? '/app';
  await cp(join(app, 'workflows'), join(root, 'workflows'), { recursive: true });
  await cp(join(app, 'packages'), join(root, 'packages'), { recursive: true });
  const project = join(root, 'workflows/cre-verify');
  await writeFile(join(project, 'verify-order/config.staging.json'), JSON.stringify({
    apiUrl: `http://127.0.0.1:${server.address().port}`, dohUrl: 'https://cloudflare-dns.com/dns-query',
  }));
  const envfile = join(root, 'secrets.env');
  await writeFile(envfile, `CRE_VERIFIER_TOKEN=${token}\n`, { mode: 0o600 });
  const args = ['workflow', 'simulate', 'verify-order', '--non-interactive', '--trigger-index', '0',
    '--skip-type-checks', '--target', 'staging-settings', '--http-payload',
    JSON.stringify({ orderId: 'smoke-nonpaying', sha256 }), '-R', project, '-e', envfile];
  // Override the production callback secret for this subprocess and isolated fixture only.
  const child = spawn(process.env.CRE_BIN ?? '/usr/local/bin/cre', args, {
    cwd: project, env: { ...process.env, CRE_VERIFIER_TOKEN: token }, stdio: ['ignore', 'ignore', 'ignore'],
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 180000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); }
  finally { clearTimeout(timeout); }
  if (code !== 0 || verdict !== 'FAIL') throw new Error(`Non-paying CRE simulation smoke failed (exit ${code}); raw CLI output suppressed`);
  console.log('Authenticated CRE simulation: PASS. Unsigned synthetic evidence rejected with FAIL; callback checked.');
  console.log('No real orders, database writes or chain transactions. Simulation does not attest a real TEE.');
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
}
