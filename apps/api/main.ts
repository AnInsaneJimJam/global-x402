import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
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
// Dashboard (apps/web, built with `npm run build:web`) served from the same origin with a strict CSP.
const webRoot = fileURLToPath(new URL('../web/dist/', import.meta.url));
const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'";
if (existsSync(webRoot)) await app.register(fastifyStatic, { root: webRoot, setHeaders: reply => {
  reply.header('content-security-policy', csp); reply.header('x-content-type-options', 'nosniff'); } });
app.addHook('onClose', async () => store.close());
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ host, port: Number(process.env.PORT ?? 3000) });
console.log((existsSync(webRoot) ? 'API and dashboard' : 'API (run `npm run build:web` for the dashboard)') + ' on http://127.0.0.1:' + (process.env.PORT ?? 3000) + ' (per-order labels show LIVE or MOCK for payment, merchant and verifier).');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, async () => { await app.close(); });
