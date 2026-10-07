import { Store } from '../packages/procurement/store.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const store = new Store(process.env.DATABASE_URL);
try { await store.migrate(); console.log('Control-contract schema ready.'); } finally { await store.close(); }
