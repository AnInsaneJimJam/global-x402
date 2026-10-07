import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

// Use the same offline generator that the pinned upstream seed uses. Never print phrases.
try {
  const require = createRequire('/usr/src/app/package.json');
  const { MeshWallet } = await import(pathToFileURL(require.resolve('@meshsdk/core')).href);
  const path = '/run/gob/.env';
  let content = await readFile(path, 'utf8');
  for (const name of ['PURCHASE_WALLET_PREPROD_MNEMONIC', 'SELLING_WALLET_PREPROD_MNEMONIC']) {
    const line = new RegExp(`^${name}=(.*)$`, 'm');
    const match = content.match(line);
    if (!match) throw new Error('MISSING_ENV_NAME');
    if (match[1].trim() && match[1].trim() !== '""' && match[1].trim() !== "''") continue;
    const words = MeshWallet.brew(false);
    if (!Array.isArray(words) || words.length !== 24) throw new Error('INVALID_GENERATOR_OUTPUT');
    content = content.replace(line, () => `${name}="${words.join(' ')}"`);
  }
  await writeFile(path, content, { mode: 0o600 });
  const env = parseEnv(content);
  const wallets = [];
  for (const [type, name] of [['Purchasing', 'PURCHASE_WALLET_PREPROD_MNEMONIC'], ['Selling', 'SELLING_WALLET_PREPROD_MNEMONIC']]) {
    const wallet = new MeshWallet({ networkId: 0, key: { type: 'mnemonic', words: env[name].trim().split(/\s+/) } });
    const address = (await wallet.getUnusedAddresses())[0];
    if (!address?.startsWith('addr_test1')) throw new Error('INVALID_TEST_WALLET');
    wallets.push({ type, address });
  }
  console.log('Preprod wallet phrases are stored in the ignored node .env; existing phrases were preserved.');
  console.log(JSON.stringify({ network: 'cardano:preprod', custody: 'OPERATOR_HELD_TEST_WALLETS',
    evidence: 'OFFLINE_DERIVED_ONLY', wallets }, null, 2));
} catch {
  console.error('Wallet initialization failed. No secret values are printed. Check the pinned image and node .env path.');
  process.exitCode = 1;
}
