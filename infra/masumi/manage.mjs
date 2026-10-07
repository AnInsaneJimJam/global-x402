import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const path = new URL('./.env', import.meta.url);
const command = process.argv[2];
try {
  if (command === 'init') {
    const template = await readFile(new URL('./.env.example', import.meta.url), 'utf8');
    let content = template;
    for (const name of ['POSTGRES_PASSWORD', 'ADMIN_KEY', 'ENCRYPTION_KEY']) {
      content = content.replace(new RegExp(`^${name}=$`, 'm'), `${name}=${randomBytes(32).toString('hex')}`);
    }
    try {
      await writeFile(path, content, { flag: 'wx', mode: 0o600 });
      console.log('Created ignored infra/masumi/.env with local node secrets. Add the Preprod Blockfrost key there.');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      console.log('Existing node .env preserved; no credentials were regenerated.');
    }
  } else {
    const env = parseEnv(await readFile(path, 'utf8'));
    await chmod(path, 0o600);
    const names = ['POSTGRES_PASSWORD', 'ADMIN_KEY', 'ENCRYPTION_KEY', 'BLOCKFROST_API_KEY_PREPROD',
      'PURCHASE_WALLET_PREPROD_MNEMONIC', 'SELLING_WALLET_PREPROD_MNEMONIC'];
    if (command === 'check') {
      for (const name of names) console.log(`${name}: ${env[name]?.trim() ? 'set' : 'missing'}`);
      const invalid = !/^[a-zA-Z0-9_-]{32,}$/.test(env.POSTGRES_PASSWORD ?? '') ||
        (env.ADMIN_KEY?.length ?? 0) < 32 || env.ADMIN_KEY === 'DefaultUnsecureAdminKey' ||
        (env.ENCRYPTION_KEY?.length ?? 0) < 32;
      const complete = names.every(name => env[name]?.trim()) && /^preprod[a-zA-Z0-9]+$/.test(env.BLOCKFROST_API_KEY_PREPROD ?? '') &&
        env.PURCHASE_WALLET_PREPROD_MNEMONIC !== env.SELLING_WALLET_PREPROD_MNEMONIC;
      if (invalid || !complete) process.exitCode = 1;
    } else if (command === 'asset') {
      if (!/^preprod[a-zA-Z0-9]+$/.test(env.BLOCKFROST_API_KEY_PREPROD ?? '')) throw new Error('MISSING_PREPROD_KEY');
      const unit = '16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d';
      const response = await fetch(`https://cardano-preprod.blockfrost.io/api/v0/assets/${unit}`,
        { headers: { project_id: env.BLOCKFROST_API_KEY_PREPROD }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`BLOCKFROST_HTTP_${response.status}`);
      const asset = await response.json();
      const decimals = asset.metadata?.decimals;
      console.log(JSON.stringify({ observedAt: new Date().toISOString(), source: 'BLOCKFROST_PREPROD',
        unit: asset.asset, policyId: asset.policy_id, assetNameHex: asset.asset_name,
        fingerprint: asset.fingerprint, quantity: asset.quantity,
        decimals: Number.isSafeInteger(decimals) && decimals >= 0 ? decimals : null,
        decimalsStatus: Number.isSafeInteger(decimals) && decimals >= 0 ? 'TOKEN_REGISTRY_METADATA' : 'UNVERIFIED' }, null, 2));
    } else if (command === 'status') {
      if (!env.ADMIN_KEY) throw new Error('MISSING_ADMIN_KEY');
      const base = 'http://127.0.0.1:3001/api/v1';
      const get = async url => {
        const response = await fetch(url, { headers: { token: env.ADMIN_KEY }, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        return response.json();
      };
      const health = await get(`${base}/health`);
      const body = await get(`${base}/wallet/list?take=100`);
      if (!Array.isArray(body.data?.Wallets)) throw new Error('UNEXPECTED_WALLET_RESPONSE');
      if (body.data.Wallets.length >= 100) throw new Error('WALLET_PAGINATION_REQUIRED');
      const wallets = [];
      for (const wallet of body.data.Wallets) {
        if (!wallet.walletAddress?.startsWith('addr_test1')) throw new Error('NON_PREPROD_WALLET');
        let balances = null;
        if (/^preprod[a-zA-Z0-9]+$/.test(env.BLOCKFROST_API_KEY_PREPROD ?? '')) {
          const response = await fetch(`https://cardano-preprod.blockfrost.io/api/v0/addresses/${encodeURIComponent(wallet.walletAddress)}`,
            { headers: { project_id: env.BLOCKFROST_API_KEY_PREPROD }, signal: AbortSignal.timeout(15_000) });
          if (response.status === 404) balances = [];
          else if (!response.ok) throw new Error(`BLOCKFROST_HTTP_${response.status}`);
          else {
            const chain = await response.json();
            balances = chain.amount.map(asset => ({ unit: asset.unit, quantity: asset.quantity }));
          }
        }
        wallets.push({ id: wallet.id, type: wallet.type, paymentSourceId: wallet.paymentSourceId, walletVkey: wallet.walletVkey,
          address: wallet.walletAddress, collectionAddress: wallet.collectionAddress, balances });
      }
      console.log(JSON.stringify({ observedAt: new Date().toISOString(), network: 'cardano:preprod',
        custody: 'OPERATOR_HELD_TEST_WALLETS', health: health.data?.status ?? 'UNKNOWN', wallets,
        balanceSource: env.BLOCKFROST_API_KEY_PREPROD ? 'BLOCKFROST_PREPROD' : 'NOT_CONFIGURED' }, null, 2));
    } else {
      console.error('Usage: node infra/masumi/manage.mjs init|check|status|asset');
      process.exitCode = 1;
    }
  }
} catch (error) {
  const code = typeof error.code === 'string' ? error.code : /^HTTP_\d+$|^BLOCKFROST_HTTP_\d+$/.test(error.message) ? error.message : 'SETUP_OR_REQUEST_FAILED';
  console.error(`${code}. See infra/masumi/README.md; no credential values are printed.`);
  process.exitCode = 1;
}
