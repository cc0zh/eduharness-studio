import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import interruption from './m3/scenarios/c3-interrupt.mjs';
import { rehearseFaux } from './m3-rehearsal.mjs';

test('M3 Chromium smoke cuts a queued beat and exports the acknowledged public dialogue', {
  timeout: 60_000,
}, async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'studio-m3-smoke-'));
  t.after(() => rmSync(out, { force: true, recursive: true }));
  await rehearseFaux(out, [interruption], t.signal);
  const receipt = JSON.parse(readFileSync(join(out, 'rehearsal.json'), 'utf8'));
  assert.equal(receipt.exportExit, 0);
  assert.equal(receipt.totalPosts, 3);
  assert.equal(receipt.networkBlocks, 0);
});
