import { Store } from '../../packages/procurement/store.js';
import { runOne } from './worker.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const store = new Store(url);
let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });
try {
  await store.migrate();
  while (!stopping) {
    if (!await runOne(store)) await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally { await store.close(); }
