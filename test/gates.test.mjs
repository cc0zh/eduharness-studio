import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkBoundaries } from '../scripts/check-boundaries.mjs';
import { checkCodeHygiene } from '../scripts/check-code-hygiene.mjs';
import { checkDocs } from '../scripts/check-docs.mjs';

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('boundary gate rejects forbidden cross-layer imports', () => {
  const dir = makeTempDir('studio-boundary-');
  try {
    mkdirSync(join(dir, 'packages/engine/src'), { recursive: true });
    mkdirSync(join(dir, 'apps/server/src'), { recursive: true });
    mkdirSync(join(dir, 'apps/web/src'), { recursive: true });

    writeFileSync(
      join(dir, 'packages/engine/src/bad.ts'),
      "import { DatabaseSync } from 'node:sqlite';\nexport const x = DatabaseSync;\n",
    );
    writeFileSync(
      join(dir, 'apps/server/src/bad.ts'),
      "import React from 'react';\nexport const y = React;\n",
    );
    writeFileSync(
      join(dir, 'apps/web/src/bad.ts'),
      "import { Hono } from 'hono';\nexport const z = Hono;\n",
    );

    assert.throws(
      () => checkBoundaries(dir),
      (err) => {
        assert.match(err.message, /packages\/engine\/src\/bad\.ts/);
        assert.match(err.message, /apps\/server\/src\/bad\.ts/);
        assert.match(err.message, /apps\/web\/src\/bad\.ts/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('boundary gate restricts @earendil-works/pi-ai to packages/engine/src/models.ts only', () => {
  const dir = makeTempDir('studio-models-');
  try {
    mkdirSync(join(dir, 'packages/engine/src'), { recursive: true });
    writeFileSync(
      join(dir, 'packages/engine/src/models.ts'),
      "import { createModels } from '@earendil-works/pi-ai';\nexport const m = createModels;\n",
    );
    assert.equal(checkBoundaries(dir).checkedFiles, 1);

    writeFileSync(
      join(dir, 'packages/engine/src/other.ts'),
      "import { createModels } from '@earendil-works/pi-ai';\nexport const m = createModels;\n",
    );
    assert.throws(() => checkBoundaries(dir), /仅 packages\/engine\/src\/models\.ts 允许导入/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('docs gate rejects stray root markdown and broken local links', () => {
  const dir = makeTempDir('studio-docs-');
  try {
    mkdirSync(join(dir, 'docs/plans'), { recursive: true });
    mkdirSync(join(dir, 'docs/archive'), { recursive: true });
    mkdirSync(join(dir, 'docs/learnings'), { recursive: true });

    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
    writeFileSync(join(dir, 'README.md'), `${'# Studio\n'.repeat(26)}[broken](docs/missing.md)\n`);
    writeFileSync(join(dir, 'STRAY.md'), '# Not allowed\n');
    writeFileSync(join(dir, 'docs/README.md'), '# Docs\n');
    for (const file of [
      'docs/status.md',
      'docs/scenarios.md',
      'docs/runbook.md',
      'docs/glossary.md',
      'docs/history.md',
      'docs/plans/roadmap.md',
      'docs/archive/README.md',
      'docs/learnings/README.md',
    ]) {
      writeFileSync(join(dir, file), '# Doc\n');
    }

    assert.throws(
      () => checkDocs(dir),
      (err) => {
        assert.match(err.message, /STRAY\.md/);
        assert.match(err.message, /链接目标不存在/);
        assert.match(err.message, /未收录到 docs\/README\.md/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('code hygiene gate rejects stray root files, @ts-ignore, explicit any, and oversized files', () => {
  const dir = makeTempDir('studio-hygiene-');
  try {
    mkdirSync(join(dir, 'apps/web/src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}\n');
    writeFileSync(join(dir, '.git'), 'gitdir: ../.git/worktrees/example\n');
    assert.doesNotThrow(() => checkCodeHygiene(dir));
    writeFileSync(join(dir, 'stray.txt'), 'oops\n');
    writeFileSync(
      join(dir, 'apps/web/src/bloated.ts'),
      [
        '// @ts-ignore',
        'export const bad = (1 as any);',
        ...Array.from({ length: 365 }, (_, i) => `export const line${i} = ${i};`),
      ].join('\n'),
    );

    assert.throws(
      () => checkCodeHygiene(dir),
      (err) => {
        assert.match(err.message, /stray\.txt/);
        assert.match(err.message, /@ts-ignore/);
        assert.match(err.message, /显式 any/);
        assert.match(err.message, /超过单文件上限/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
