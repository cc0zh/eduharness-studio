import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rehearsalOptions, rehearseFaux } from './m3-rehearsal.mjs';

test('M3 Chromium faux preserves all four zero-key scripted contracts and exports', {
  timeout: 180_000,
}, async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'studio-m3-smoke-'));
  t.after(() => rmSync(out, { force: true, recursive: true }));
  await rehearseFaux(out, rehearsalOptions(['--out-dir', out]).scenes, t.signal);
  const receipt = JSON.parse(readFileSync(join(out, 'rehearsal.json'), 'utf8'));
  assert.equal(receipt.exportExit, 0);
  assert.deepEqual(
    receipt.results.map(({ posts, status }) => [posts, status]),
    [
      [5, 'handoff'],
      [6, 'handoff'],
      [3, 'handoff'],
      [5, 'handoff'],
    ],
  );
  assert.equal(receipt.exported, 4);
  assert.equal(receipt.totalPosts, 19);
  assert.equal(receipt.networkBlocks, 0);
});
