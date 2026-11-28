import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { selectCheckScope } from '../scripts/check-changed.mjs';
import { listTestFiles } from '../scripts/run-tests.mjs';

test('selectCheckScope selects fast for pure engine, server, docs, or non-browser tests', () => {
  assert.deepEqual(
    selectCheckScope([
      'packages/engine/src/teacher.ts',
      'apps/server/src/app.ts',
      'docs/status.md',
      'test/teacher-api.test.ts',
    ]),
    { mode: 'fast', reason: 'no-web-or-browser-changes' },
  );
  assert.deepEqual(selectCheckScope([]), {
    mode: 'fast',
    reason: 'no-web-or-browser-changes',
  });
});

test('selectCheckScope falls back to full when web, browser, root config, or null diff appears', () => {
  assert.deepEqual(selectCheckScope(null), {
    mode: 'full',
    reason: 'git-diff-unavailable',
  });

  const fullTriggers = [
    'apps/web/src/App.tsx',
    'test/browser-m1.test.mjs',
    'test/m3/classroom.mjs',
    'test/m3-rehearsal.mjs',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'scripts/check.mjs',
    'scripts/check-changed.mjs',
    'scripts/run-tests.mjs',
    'scripts/web-vite.mjs',
    '.github/workflows/ci.yml',
  ];

  for (const file of fullTriggers) {
    assert.deepEqual(selectCheckScope(['packages/engine/src/course.ts', file]), {
      mode: 'full',
      reason: `matched:${file}`,
    });
  }
});

test('listTestFiles partitions fast unit/api tests and browser e2e tests cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-run-tests-'));
  try {
    mkdirSync(join(dir, 'packages/engine/test'), { recursive: true });
    mkdirSync(join(dir, 'test'), { recursive: true });

    writeFileSync(join(dir, 'packages/engine/test/course.test.ts'), '');
    writeFileSync(join(dir, 'test/teacher-api.test.ts'), '');
    writeFileSync(join(dir, 'test/gates.test.mjs'), '');
    writeFileSync(join(dir, 'test/browser-m1.test.mjs'), '');
    writeFileSync(join(dir, 'test/browser-m3-smoke.test.mjs'), '');
    writeFileSync(join(dir, 'test/helper.mjs'), '');

    const fastFiles = listTestFiles(dir, 'fast');
    const e2eFiles = listTestFiles(dir, 'e2e');
    const allFiles = listTestFiles(dir, 'all');

    assert.equal(fastFiles.length, 3);
    assert.ok(fastFiles.every((f) => !/[\\/]browser-/.test(f)));
    assert.equal(e2eFiles.length, 2);
    assert.ok(e2eFiles.every((f) => /[\\/]browser-.*\.test\.(?:mjs|ts)$/.test(f)));
    assert.equal(allFiles.length, fastFiles.length + e2eFiles.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
