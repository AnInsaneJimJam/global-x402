import { Store } from '../../packages/procurement/store.js';
import { Procurement } from '../../packages/procurement/service.js';
import type { Actor } from '../../packages/contracts/index.js';
import { createApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
const buyerToken = process.env.DEV_BUYER_TOKEN;
const fillerToken = process.env.DEV_FILLER_TOKEN;
if (!databaseUrl || !buyerToken || !fillerToken || buyerToken === fillerToken) {
  throw new Error('Set DATABASE_URL and distinct DEV_BUYER_TOKEN/DEV_FILLER_TOKEN. Local development only.');
}
const store = new Store(databaseUrl);
await store.migrate();
const sessions = new Map<string, Actor>([
  [buyerToken, { id: 'dev-buyer', role: 'BUYER' }],
  [fillerToken, { id: 'dev-filler', role: 'FILLER' }],
]);
const app = createApp(new Procurement(store), sessions);
app.addHook('onClose', async () => store.close());
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
console.log('Local control API running on localhost. All payment, merchant and verifier layers are MOCK.');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, async () => { await app.close(); });
