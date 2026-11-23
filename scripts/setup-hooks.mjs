import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

if (!existsSync(join(root, '.git'))) {
  process.exit(0);
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.warn('[prepare] Could not configure git core.hooksPath; continuing.');
  process.exit(0);
}

console.log('[prepare] Configured git core.hooksPath -> .githooks');
