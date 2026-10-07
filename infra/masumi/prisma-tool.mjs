import { spawnSync } from 'node:child_process';

const mode = process.argv[2];
if (!['migrate', 'seed', 'preflight'].includes(mode)) {
  console.error('Use migrate, seed or preflight');
  process.exit(1);
}
const required = ['DATABASE_URL', 'ADMIN_KEY', 'ENCRYPTION_KEY'];
if (mode === 'seed') required.push('BLOCKFROST_API_KEY_PREPROD',
  'PURCHASE_WALLET_PREPROD_MNEMONIC', 'SELLING_WALLET_PREPROD_MNEMONIC');
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Cannot ${mode}: missing ${missing.join(', ')}. Set them in infra/masumi/.env locally.`);
  process.exit(1);
}
if (process.env.ADMIN_KEY.length < 32 || process.env.ADMIN_KEY === 'DefaultUnsecureAdminKey' ||
  process.env.ENCRYPTION_KEY.length < 32) {
  console.error('Explicit ADMIN_KEY and ENCRYPTION_KEY must each be at least 32 characters.');
  process.exit(1);
}
if (mode === 'seed' && (!/^preprod[a-zA-Z0-9]+$/.test(process.env.BLOCKFROST_API_KEY_PREPROD) ||
  process.env.PURCHASE_WALLET_PREPROD_MNEMONIC.trim() === process.env.SELLING_WALLET_PREPROD_MNEMONIC.trim())) {
  console.error('Seed requires a Preprod Blockfrost project key and distinct purchasing/selling wallet phrases.');
  process.exit(1);
}
// Raw upstream errors can contain secrets. Surface only exit status and Prisma error codes.
const args = mode === 'preflight'
  ? ['node_modules/tsx/dist/cli.mjs', '-e', "import { getPaymentScriptV2 } from './src/utils/generator/contract-generator'; import { DEFAULTS } from '@masumi/payment-core/config'; if (typeof getPaymentScriptV2 !== 'function' || !DEFAULTS) process.exit(1);"]
  : ['node_modules/prisma/build/index.js', ...(mode === 'seed' ? ['db', 'seed'] : ['migrate', 'deploy']), '--config', 'prisma/prisma.config.ts'];
const result = spawnSync(process.execPath, args,
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: mode === 'preflight' ? 60_000 : undefined,
    env: { ...process.env, PATH: `/usr/src/app/node_modules/.bin:${process.env.PATH ?? ''}` } });
if (result.status !== 0) {
  const codes = [...new Set(`${result.stdout ?? ''}${result.stderr ?? ''}`
    .match(/\b(?:P\d{4}|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED)\b/g) ?? [])];
  console.error(`Masumi ${mode} failed (exit ${result.status ?? 'unknown'}${codes.length ? `; ${codes.join(', ')}` : ''}). Raw output suppressed.`);
  process.exit(1);
}
console.log(`Masumi ${mode} completed. No secrets are printed.`);
