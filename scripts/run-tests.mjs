import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function listTests(dir, pattern) {
  try {
    return readdirSync(dir)
      .filter((name) => pattern.test(name))
      .sort()
      .map((name) => join(dir, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const files = [
  ...listTests(join(root, 'packages', 'engine', 'test'), /\.test\.ts$/),
  ...listTests(join(root, 'test'), /\.test\.(?:mjs|ts)$/),
];

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
