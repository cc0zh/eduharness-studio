import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const BROWSER_TEST_RE = /^browser-.*\.test\.(?:mjs|ts)$/;

function listMatchingFiles(dir, predicate) {
  try {
    return readdirSync(dir)
      .filter(predicate)
      .sort()
      .map((name) => join(dir, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function listTestFiles(root = defaultRoot, mode = 'all') {
  const absRoot = resolve(root);
  const engineTests =
    mode === 'e2e'
      ? []
      : listMatchingFiles(join(absRoot, 'packages', 'engine', 'test'), (name) =>
          /\.test\.ts$/.test(name),
        );
  const rootTests = listMatchingFiles(join(absRoot, 'test'), (name) => {
    if (!/\.test\.(?:mjs|ts)$/.test(name)) return false;
    if (mode === 'fast') return !BROWSER_TEST_RE.test(name);
    if (mode === 'e2e') return BROWSER_TEST_RE.test(name);
    return true;
  });
  return [...engineTests, ...rootTests];
}

function parseMode(argv) {
  if (argv.includes('--fast')) return 'fast';
  if (argv.includes('--e2e')) return 'e2e';
  return 'all';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = parseMode(process.argv.slice(2));
  const files = listTestFiles(defaultRoot, mode);
  if (files.length === 0) {
    console.error(`No test files found for mode "${mode}".`);
    process.exit(1);
  }
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', '--test-concurrency=1', ...files],
    {
      cwd: defaultRoot,
      stdio: 'inherit',
    },
  );
  process.exit(result.status ?? 1);
}
