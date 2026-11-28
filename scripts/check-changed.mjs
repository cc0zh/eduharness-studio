import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));

const FULL_EXACT_PATHS = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'scripts/check.mjs',
  'scripts/check-changed.mjs',
  'scripts/run-tests.mjs',
  'scripts/web-vite.mjs',
]);

function needsFullCheck(posixPath) {
  if (FULL_EXACT_PATHS.has(posixPath)) return true;
  if (posixPath === 'test/m3-rehearsal.mjs') return true;
  return (
    posixPath.startsWith('apps/web/') ||
    posixPath.startsWith('test/browser-') ||
    posixPath.startsWith('test/m3/') ||
    posixPath.startsWith('.github/workflows/')
  );
}

export function selectCheckScope(changedFiles) {
  if (changedFiles === null) {
    return { mode: 'full', reason: 'git-diff-unavailable' };
  }
  for (const rawPath of changedFiles) {
    const posixPath = rawPath.replace(/\\/g, '/').trim();
    if (!posixPath) continue;
    if (needsFullCheck(posixPath)) {
      return { mode: 'full', reason: `matched:${posixPath}` };
    }
  }
  return { mode: 'fast', reason: 'no-web-or-browser-changes' };
}

function runGit(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

function resolveMergeBase(root) {
  for (const ref of ['origin/main', 'main']) {
    const res = runGit(root, ['merge-base', ref, 'HEAD']);
    if (res.status === 0 && res.stdout.trim()) {
      return res.stdout.trim();
    }
  }
  return null;
}

function collectChangedFiles(root) {
  const base = resolveMergeBase(root);
  if (!base) return null;
  const commands = [
    ['diff', '--name-only', `${base}...HEAD`],
    ['diff', '--name-only', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard'],
  ];
  const files = new Set();
  for (const args of commands) {
    const res = runGit(root, args);
    if (res.status !== 0) return null;
    for (const line of res.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
  }
  return [...files].sort();
}

function runStep(root, label, args) {
  console.log(`\n==> ${label}`);
  const res = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\n[check:changed] Failed at step: ${label}`);
    process.exit(res.status ?? 1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const forceFast = args.includes('--fast');
  const dryRun = args.includes('--dry');
  const changedFiles = forceFast ? [] : collectChangedFiles(defaultRoot);
  const scope = forceFast
    ? { mode: 'fast', reason: 'forced:--fast' }
    : selectCheckScope(changedFiles);

  console.log(`[check:changed] mode=${scope.mode} (${scope.reason})`);
  if (dryRun) {
    if (Array.isArray(changedFiles)) {
      console.log(`[check:changed] changed files (${changedFiles.length}):`);
      for (const file of changedFiles) console.log(`  - ${file}`);
    }
    process.exit(0);
  }

  const startedAt = Date.now();
  if (scope.mode === 'full') {
    runStep(defaultRoot, 'Full check (static + web build + unit + Playwright E2E)', [
      'scripts/check.mjs',
    ]);
  } else {
    runStep(defaultRoot, 'Static gates (boundaries + docs + hygiene + biome + tsc)', [
      'scripts/check-static.mjs',
    ]);
    runStep(defaultRoot, 'Fast tests (unit + API/smoke, skipping Playwright E2E)', [
      'scripts/run-tests.mjs',
      '--fast',
    ]);
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `\n[check:changed] Fast gate passed in ${elapsedSec}s (skipped web Vite build & Playwright E2E; full check runs on UI/global changes and CI).`,
    );
  }
}
