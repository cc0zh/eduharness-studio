import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const steps = [
  {
    name: 'Static gates (boundaries + docs + hygiene + biome + tsc)',
    cmd: process.execPath,
    args: ['scripts/check-static.mjs'],
  },
  { name: 'Web production build', cmd: process.execPath, args: [viteBin, 'build', 'apps/web'] },
  {
    name: 'Tests (unit + gates + HTTP smoke + Playwright)',
    cmd: process.execPath,
    args: ['scripts/run-tests.mjs'],
  },
];

for (const step of steps) {
  console.log(`\n==> ${step.name}`);
  const result = spawnSync(step.cmd, step.args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n[check] Failed at step: ${step.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nAll checks passed.');
