import { spawnSync, spawn } from 'node:child_process';
const migration = spawnSync(process.execPath, ['/opt/gob/prisma-tool.mjs', 'migrate'], { stdio: 'inherit' });
if (migration.status !== 0) process.exit(1);
// Upstream logs may contain provider credentials: surface only lifecycle status.
const child = spawn(process.execPath, ['dist/index.js'], { stdio: 'ignore', env: process.env });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Masumi process could not start'); process.exit(1); });
child.on('exit', code => { console.log(`Masumi stopped (exit ${code ?? 'signal'})`); process.exit(code ?? 1); });
