import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const origin = new URL(process.env.RAILWAY_API_ORIGIN ?? '');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
  throw new Error('RAILWAY_API_ORIGIN must be the HTTPS origin of the deployed API');
execFileSync('npm', ['run', 'build:web'], { stdio: 'inherit' });
await rm('.vercel/output', { recursive: true, force: true });
await mkdir('.vercel/output', { recursive: true });
await cp('apps/web/dist', '.vercel/output/static', { recursive: true });
await writeFile('.vercel/output/config.json', JSON.stringify({ version: 3, routes: [
  { src: '/v1/(.*)', dest: `${origin.origin}/v1/$1`, headers: { 'cache-control': 'no-store' } },
  { handle: 'filesystem' },
  { src: '/.*', dest: '/index.html' },
]}, null, 2));
