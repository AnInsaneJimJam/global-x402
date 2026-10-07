// One-time Masumi node wiring for the app (idempotent). Requires the node from infra/masumi to be seeded and running.
// 1. Creates scoped buyer (purchasing wallet) and filler (selling wallet) API keys.
// 2. Registers the filler agent on Preprod (on-chain; selling wallet needs tADA) and waits for confirmation.
// 3. Writes BUYER_/FILLER_MASUMI_URL/TOKEN, FILLER_AGENT_IDENTIFIER and ESCROW_ASSET_ID into the ignored root .env.
// Prints only public values (addresses, agent id) and "written"/"exists" for secrets.
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const nodeEnv = parseEnv(await readFile(new URL('../infra/masumi/.env', import.meta.url), 'utf8'));
const rootPath = new URL('../.env', import.meta.url);
const rootText = await readFile(rootPath, 'utf8').catch(() => '');
const root = parseEnv(rootText);
const base = process.env.MASUMI_URL ?? 'http://127.0.0.1:3001/api/v1';
const TUSDM = '16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde.0014df10745553444d';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { token: nodeEnv.ADMIN_KEY!, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const json = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(`${method} ${path} → HTTP ${response.status} ${json.error?.message ?? ''}`.trim());
  return json.data as T;
}
const updates = new Map<string, string>();
const set = (name: string, value: string) => { if (root[name] !== value) updates.set(name, value); };

type Wallet = { id: string; type: string; walletVkey: string; walletAddress: string };
const { Wallets } = await api<{ Wallets: Wallet[] }>('GET', '/wallet/list?take=100');
const purchasing = Wallets.find(w => w.type === 'Purchasing'), selling = Wallets.find(w => w.type === 'Selling');
if (!purchasing || !selling) throw new Error('Node is not seeded: expected one Purchasing and one Selling wallet.');
console.log(`buyer (purchasing) wallet: ${purchasing.walletAddress}\nfiller (selling) wallet:   ${selling.walletAddress}`);

for (const [prefix, wallet] of [['BUYER', purchasing], ['FILLER', selling]] as const) {
  if (root[`${prefix}_MASUMI_TOKEN`]) { console.log(`${prefix} key: exists`); continue; }
  const key = await api<{ token: string }>('POST', '/api-key', { canRead: true, canPay: true, canAdmin: false, usageLimited: 'false',
    NetworkLimit: ['Preprod'], walletScopeEnabled: true, WalletScopeHotWalletIds: [wallet.id] });
  set(`${prefix}_MASUMI_TOKEN`, key.token);
  console.log(`${prefix} key: written (scoped to ${wallet.type} wallet, Preprod only)`);
}
set('BUYER_MASUMI_URL', base); set('FILLER_MASUMI_URL', base); set('ESCROW_ASSET_ID', root.ESCROW_ASSET_ID ?? TUSDM);

type Entry = { agentIdentifier: string | null; state: string; SmartContractWallet?: { walletVkey: string } };
const registered = async () => (await api<{ Assets: Entry[] }>('GET', '/registry?network=Preprod&limit=100')).Assets
  .find(entry => entry.SmartContractWallet?.walletVkey === selling.walletVkey);
let entry = await registered();
if (!entry) {
  const { PaymentSources } = await api<{ PaymentSources: { network: string; paymentSourceType: string; smartContractAddress: string }[] }>(
    'GET', '/payment-source?take=10');
  const source = PaymentSources.find(p => p.network === 'Preprod' && p.paymentSourceType === 'Web3CardanoV2');
  if (!source) throw new Error('No Preprod Web3CardanoV2 payment source on the node.');
  await api('POST', '/registry', { network: 'Preprod', type: 'Standard', sellingWalletVkey: selling.walletVkey,
    name: 'Global Order Book filler (Preprod test)',
    description: 'Preprod test identity for human-assisted order placement. Operator-held test wallet; local test service.',
    apiBaseUrl: process.env.FILLER_SERVICE_URL ?? 'http://127.0.0.1:3000/v1', Tags: ['procurement', 'preprod-test'], ExampleOutputs: [],
    Capability: { name: 'human-assisted-order-placement', version: '0.1.0' }, Author: { name: 'Global Order Book demo operator' },
    supportedPaymentSources: [{ chain: 'Cardano', network: 'Preprod', paymentSourceType: 'Web3CardanoV2',
      address: source.smartContractAddress, pricing: { pricingType: 'Dynamic' } }] });
  console.log('filler registration: submitted (on-chain, usually a few minutes)');
}
for (let tries = 0; !(entry?.state === 'RegistrationConfirmed' && entry.agentIdentifier); tries++) {
  if (entry?.state?.endsWith('Failed')) throw new Error(`Registration ${entry.state}; check the node admin UI.`);
  if (tries > 60) throw new Error('Registration not confirmed after ~10 minutes; rerun this script later.');
  await new Promise(resolve => setTimeout(resolve, 10_000));
  entry = await registered();
  process.stdout.write(`  registration state: ${entry?.state ?? 'pending'}\r`);
}
set('FILLER_AGENT_IDENTIFIER', entry.agentIdentifier);
console.log(`\nfiller agent: ${entry.agentIdentifier}`);

// Upsert into the ignored root .env without echoing values.
let text = rootText;
for (const [name, value] of updates) {
  text = new RegExp(`^${name}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${value}`)
    : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${name}=${value}\n`;
}
await writeFile(rootPath, text, { mode: 0o600 });
console.log(`.env updated: ${[...updates.keys()].join(', ') || 'nothing to change'}`);
