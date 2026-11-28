import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { captureScene, writeJson } from './m3/classroom.mjs';
import { exportScene } from './m3/export-scene.mjs';
import { liveSceneLimits, runMode } from './m3/mode.mjs';
import { postBudget } from './m3/post-budget.mjs';
import transfer from './m3/scenarios/c1-transfer.mjs';
import pressure from './m3/scenarios/c2-pressure.mjs';
import interruption from './m3/scenarios/c3-interrupt.mjs';
import prerequisite from './m3/scenarios/c4-prereq.mjs';
import { SceneStop } from './m3/scene-stop.mjs';
import { offlineNetworkEnv } from './studio-test-env.mjs';

const m3Scenes = [transfer, pressure, interruption, prerequisite];
const liveOrder = Object.keys(liveSceneLimits);

function selectScenes(ids, live) {
  if (live && (ids?.length !== liveOrder.length || liveOrder.some((id, i) => ids[i] !== id))) {
    throw new Error(`--live requires explicit ordered --scene options: ${liveOrder.join(', ')}`);
  }
  if (!ids) return m3Scenes;
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate M3 scenario');
  return ids.map((id) => {
    const scene = m3Scenes.find((entry) => entry.id === id);
    if (!scene) throw new Error('Unknown M3 scenario');
    return scene;
  });
}

export async function runScenes(directory, scenes, settings, signal, capture = captureScene) {
  const isFaux = settings.mode === 'faux';
  const budget = postBudget(join(directory, 'post-ledger.jsonl'), {
    mode: settings.mode,
    limit: isFaux ? Number.MAX_SAFE_INTEGER : settings.limit,
  });
  const cells = [];
  const sessions = [];
  const results = [];
  for (const scene of scenes) {
    signal.throwIfAborted();
    const sceneDir = join(directory, scene.id);
    let recorded;
    let outcome;
    try {
      recorded = await capture(scene, sceneDir, settings, budget, signal);
      signal.throwIfAborted();
      budget.assertHealthy();
      if (budget.sceneBlocked(scene.id))
        throw new SceneStop('budget_exhausted', 'scene_post_limit');
      assert.equal(recorded.state, isFaux ? 'handoff' : 'completed');
      const { cell, meta } = exportScene(sceneDir, scene, recorded, settings);
      cells.push(cell);
      sessions.push(meta);
      outcome = {
        status: recorded.state,
        publicTurns: recorded.visible.length,
        transcript: cell.transcript.length,
      };
    } catch (error) {
      // The SDK can turn a run-wide fuse into a generation failure. Check it before continuing.
      budget.assertHealthy();
      signal.throwIfAborted();
      if (isFaux || !(error instanceof SceneStop)) throw error;
      const exhausted =
        budget.sceneBlocked(scene.id) ||
        (error.status === 'no_handoff' && budget.sceneLimitReached(scene.id));
      outcome = exhausted
        ? { status: 'budget_exhausted', reason: 'scene_post_limit' }
        : { status: error.status, reason: error.message };
    }
    const result = {
      scene: scene.id,
      posts: budget.postsFor(scene.id),
      ...(!isFaux && {
        teacherPosts: budget.postsFor(scene.id, 'teacher'),
        studentPosts: budget.postsFor(scene.id, 'student'),
        ...(recorded?.beats !== undefined && { beats: recorded.beats }),
      }),
      ...(recorded && { sessionId: recorded.sessionId, step: recorded.step }),
      ...outcome,
    };
    if (!isFaux) writeJson(join(sceneDir, 'result.json'), result);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  return { cells, sessions, results, totalPosts: budget.total() };
}

async function rehearse(directory, scenes, settings, signal) {
  const isFaux = settings.mode === 'faux';
  mkdirSync(directory, { recursive: true });
  for (const entry of [
    ...scenes.map(({ id }) => id),
    'plan.json',
    'manifest.json',
    'rehearsal.json',
  ]) {
    if (existsSync(join(directory, entry))) throw new Error(`M3 output already exists: ${entry}`);
  }
  const networkLog =
    process.env.STUDIO_TEST_NETWORK_LOG ?? join(directory, 'node-network-blocks.log');
  if (isFaux) {
    Object.assign(process.env, offlineNetworkEnv(networkLog));
    await import('./network-fence.mjs');
  }
  const { cells, sessions, results, totalPosts } = await runScenes(
    directory,
    scenes,
    settings,
    signal,
  );
  const networkBlocks = isFaux
    ? readFileSync(networkLog, 'utf8').split('\n').filter(Boolean).length
    : undefined;
  if (isFaux) assert.equal(networkBlocks, 0);
  writeJson(join(directory, 'plan.json'), { cells });
  writeJson(join(directory, 'manifest.json'), { sessions });
  writeJson(join(directory, 'rehearsal.json'), {
    mode: settings.mode,
    ...(isFaux && { exportExit: 0 }),
    exported: cells.length,
    totalPosts,
    networkBlocks,
    results,
  });
  if (!isFaux && results.some(({ status }) => status !== 'completed')) {
    throw new Error('M3 live acceptance incomplete; see rehearsal.json and per-scene results');
  }
}

export function rehearseFaux(directory, scenes, signal) {
  return rehearse(directory, scenes, { mode: 'faux' }, signal);
}

export function rehearsalOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      live: { type: 'boolean' },
      'out-dir': { type: 'string' },
      scene: { type: 'string', multiple: true },
    },
  });
  if (!values['out-dir']?.trim()) throw new Error('Required: --out-dir DIRECTORY');
  return {
    live: Boolean(values.live),
    directory: resolve(values['out-dir']),
    scenes: selectScenes(values.scene, values.live),
  };
}

async function main() {
  const { live, directory, scenes } = rehearsalOptions(process.argv.slice(2));
  if (live && process.env.STUDIO_TEST_NETWORK_LOG)
    throw new Error('--live cannot run inside the offline network fence');
  const settings = runMode(live, process.env);
  await rehearse(directory, scenes, settings, AbortSignal.timeout(600_000));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
