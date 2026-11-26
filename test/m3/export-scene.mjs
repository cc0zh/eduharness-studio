import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicMatch } from '../judge-public-match.mjs';
import { offlineServerEnv } from '../studio-test-env.mjs';
import { writeJson } from './classroom.mjs';
import { SceneStop } from './scene-stop.mjs';

function artifact(directory, name) {
  return JSON.parse(readFileSync(join(directory, name), 'utf8'));
}

export function exportScene(directory, scene, capture, settings) {
  const out = join(directory, 'export');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'apps/server/src/judge-export.ts',
      '--db',
      join(directory, 'studio.sqlite'),
      '--session',
      capture.sessionId,
      '--out-dir',
      out,
    ],
    {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: {
        ...offlineServerEnv(join(directory, 'no-dotenv')),
        ...settings.exportEnv,
      },
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true,
    },
  );
  const isFaux = settings.mode === 'faux';
  // The CLI distinguishes per-session validation refusals from operational errors.
  const refusal =
    result.status === 1
      ? /^judge-export: ([a-z_]+) \(session #1\)\r?$/m.exec(result.stderr)?.[1]
      : undefined;
  writeJson(join(directory, 'export-receipt.json'), {
    exit: result.status,
    refusal,
    ...(isFaux && { stdout: result.stdout, stderr: result.stderr }),
  });
  assert.ifError(result.error);
  if (!isFaux && refusal) throw new SceneStop('export_rejected', refusal);
  assert.equal(result.status, 0, isFaux ? result.stderr : 'Unexpected judge-export failure');
  const { cells } = artifact(out, 'plan.json');
  const { sessions } = artifact(out, 'manifest.json');
  assert.equal(cells.length, 1);
  assert.equal(sessions.length, 1);
  const [cell] = cells;
  const [meta] = sessions;
  assert.equal(cell.cellId, capture.sessionId);
  assert.equal(meta.sessionId, capture.sessionId);
  assert.equal(meta.last_played_step_id, capture.step);
  assert.ok(cell.transcript[0].text.includes(scene.topic));
  if (isFaux) {
    for (const forbidden of [scene.cut?.unplayed, scene.rejectedOpening].filter(Boolean))
      assert.ok(
        cell.transcript.every(({ text }) => !text.includes(forbidden)),
        'Unplayed or rejected text leaked into export',
      );
  }
  assertPublicMatch(cell.transcript, capture.quality);
  return { cell, meta };
}
