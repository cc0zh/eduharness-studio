import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertPublicMatch } from './judge-public-match.mjs';
import { captureScene, writeJson } from './m3/classroom.mjs';
import { runMode } from './m3/mode.mjs';
import { postBudget } from './m3/post-budget.mjs';
import transfer from './m3/scenarios/c1-transfer.mjs';
import pressure from './m3/scenarios/c2-pressure.mjs';
import interruption from './m3/scenarios/c3-interrupt.mjs';
import prerequisite from './m3/scenarios/c4-prereq.mjs';
import { offlineNetworkEnv, offlineServerEnv } from './studio-test-env.mjs';

function artifact(directory, name) {
  return JSON.parse(readFileSync(join(directory, name), 'utf8'));
}

function exportScene(directory, scene, capture, mode) {
  const out = join(directory, 'export');
  const npm = process.env.npm_execpath;
  const result = spawnSync(
    process.execPath,
    [
      ...(npm
        ? [npm, '--silent', 'run', 'export:judge', '--']
        : ['--import', 'tsx', 'apps/server/src/judge-export.ts']),
      '--db',
      join(directory, 'studio.sqlite'),
      '--session',
      capture.sessionId,
      '--out-dir',
      out,
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...offlineServerEnv(join(directory, 'no-dotenv')),
        NPM_CONFIG_OFFLINE: 'true',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      },
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true,
    },
  );
  writeJson(join(directory, 'export-receipt.json'), {
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
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
  if (mode === 'faux') {
    for (const forbidden of [scene.cut?.unplayed, scene.rejectedOpening].filter(Boolean))
      assert.ok(
        cell.transcript.every(({ text }) => !text.includes(forbidden)),
        'Unplayed or rejected text leaked into export',
      );
  }
  assertPublicMatch(cell.transcript, capture.quality);
  return { cell, meta };
}

async function rehearse(directory, scenes, settings, signal) {
  const isFaux = settings.mode === 'faux';
  if (!isFaux && process.env.STUDIO_TEST_NETWORK_LOG)
    throw new Error('--live cannot run inside the offline network fence');
  mkdirSync(directory, { recursive: true });
  const networkLog =
    process.env.STUDIO_TEST_NETWORK_LOG ?? join(directory, 'node-network-blocks.log');
  if (isFaux) {
    Object.assign(process.env, offlineNetworkEnv(networkLog));
    await import('./network-fence.mjs');
  }
  const budget = postBudget(
    join(directory, 'post-ledger.jsonl'),
    isFaux ? Number.MAX_SAFE_INTEGER : settings.limit,
  );
  const cells = [];
  const sessions = [];
  const results = [];
  for (const scene of scenes) {
    const sceneDir = join(directory, scene.id);
    const capture = await captureScene(scene, sceneDir, settings, budget, signal);
    const { cell, meta } = exportScene(sceneDir, scene, capture, settings.mode);
    cells.push(cell);
    sessions.push(meta);
    const result = {
      scene: scene.id,
      posts: capture.posts,
      publicTurns: capture.visible.length,
      transcript: cell.transcript.length,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const networkBlocks = isFaux
    ? readFileSync(networkLog, 'utf8').split('\n').filter(Boolean).length
    : undefined;
  if (isFaux) assert.equal(networkBlocks, 0);
  writeJson(join(directory, 'plan.json'), { cells });
  writeJson(join(directory, 'manifest.json'), { sessions });
  writeJson(join(directory, 'rehearsal.json'), {
    mode: settings.mode,
    exportExit: 0,
    totalPosts: budget.total(),
    networkBlocks,
    results,
  });
}

export function rehearseFaux(directory, scenes, signal) {
  return rehearse(directory, scenes, { mode: 'faux' }, signal);
}

const m3Scenes = [transfer, pressure, interruption, prerequisite];

async function main() {
  const { values } = parseArgs({
    options: {
      live: { type: 'boolean' },
      'out-dir': { type: 'string' },
      scene: { type: 'string' },
    },
  });
  const settings = runMode(values.live, process.env);
  if (!values['out-dir']?.trim()) throw new Error('Required: --out-dir DIRECTORY');
  const scenes = values.scene ? m3Scenes.filter(({ id }) => id === values.scene) : m3Scenes;
  if (!scenes.length) throw new Error('Unknown M3 scenario');
  await rehearse(resolve(values['out-dir']), scenes, settings, AbortSignal.timeout(600_000));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
