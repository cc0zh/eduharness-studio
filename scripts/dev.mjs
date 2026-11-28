import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webViteBin } from './web-vite.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const apiPort = process.env.PORT ?? '3001';
const webPort = process.env.WEB_PORT ?? '5173';
const env = { ...process.env, PORT: apiPort, WEB_PORT: webPort };

console.log(
  `[dev] Starting eduharness-studio (web: http://127.0.0.1:${webPort} -> api: http://127.0.0.1:${apiPort})`,
);

const server = spawn(process.execPath, [tsxCli, 'watch', 'apps/server/src/index.ts'], {
  cwd: root,
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
});

const web = spawn(process.execPath, [webViteBin, 'apps/web'], {
  cwd: root,
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
});

const children = [server, web];
let shuttingDown = false;

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(exitCode);
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown) stopAll(code ?? 1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
