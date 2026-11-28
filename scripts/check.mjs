import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { webViteBin } from './web-vite.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const steps = [
  {
    name: 'Static gates (boundaries + docs + hygiene + biome + tsc)',
    cmd: process.execPath,
    args: ['scripts/check-static.mjs'],
  },
  { name: 'Web production build', cmd: process.execPath, args: [webViteBin, 'build', 'apps/web'] },
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
