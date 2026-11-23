import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const biomeBin = join(root, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');

const steps = [
  { name: 'Import boundaries', cmd: process.execPath, args: ['scripts/check-boundaries.mjs'] },
  { name: 'Docs lint', cmd: process.execPath, args: ['scripts/check-docs.mjs'] },
  {
    name: 'Code hygiene & root whitelist',
    cmd: process.execPath,
    args: ['scripts/check-code-hygiene.mjs'],
  },
  { name: 'Biome lint & format', cmd: process.execPath, args: [biomeBin, 'check', '.'] },
  {
    name: 'Typecheck (engine + server)',
    cmd: process.execPath,
    args: [tscBin, '--noEmit', '-p', 'tsconfig.json'],
  },
  {
    name: 'Typecheck (web)',
    cmd: process.execPath,
    args: [tscBin, '--noEmit', '-p', 'apps/web/tsconfig.json'],
  },
];

for (const step of steps) {
  console.log(`\n==> ${step.name}`);
  const result = spawnSync(step.cmd, step.args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n[check:static] Failed at step: ${step.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nStatic checks passed.');
