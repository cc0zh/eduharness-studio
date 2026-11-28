import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BAYES_DEMO_ID } from '@eduharness-studio/engine';
import { exportClassroom } from './judge-export-fixture.ts';
import { captureScene } from './m3/classroom.mjs';
import { exportScene } from './m3/export-scene.mjs';
import transfer from './m3/scenarios/c1-transfer.mjs';
import { SceneStop } from './m3/scene-stop.mjs';
import { fauxKey, startScriptedModel } from './m3/scripted-model.mjs';
import { countedUpstream, fenceM3Tests, ledger, scratch } from './m3/test-loopback.mjs';
import { rehearsalOptions, runScenes } from './m3-rehearsal.mjs';

const order = ['C2-pressure', 'C1-transfer', 'C3-interrupt', 'C4-prereq'];
const flags = (ids) => ids.flatMap((id) => ['--scene', id]);
// argv is parsed in memory only; the CLI's --live entry is never started by tests.
const options = (ids = order) => rehearsalOptions(['--out-dir', 'unused', '--live', ...flags(ids)]);
const fauxOrder = ['C1-transfer', 'C2-pressure', 'C3-interrupt', 'C4-prereq'];
const differentPrompt = '合并以前，应该先记录哪些分子和分母？';
const divergingOpening = (scene) => ({
  ...scene,
  opening: { ...scene.opening, next_ask: { prompt: differentPrompt } },
});
const credentials = {
  DEEPSEEK_API_KEY: 'SyntheticM3DeepseekValueWithNoCredentialPrefix',
  OPENROUTER_API_KEY: 'SyntheticM3OpenrouterValueWithNoCredentialPrefix',
};
const livePolicy = { mode: 'live', limit: 114, exportEnv: credentials };
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

await fenceM3Tests();

test('M3 CLI requires explicit live order and preserves the default faux order', () => {
  assert.deepEqual(
    options().scenes.map(({ id }) => id),
    order,
  );
  for (const ids of [[], order.slice(1), fauxOrder, [...order.slice(0, 3), order[0]]]) {
    assert.throws(() => options(ids), /requires explicit ordered --scene/);
  }
  assert.throws(
    () => rehearsalOptions(['--out-dir', 'unused', ...flags(order), '--post-budget', '115']),
    { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' },
  );
  const offline = rehearsalOptions(['--out-dir', 'unused']);
  assert.equal(offline.live, false);
  assert.deepEqual(
    offline.scenes.map(({ id }) => id),
    fauxOrder,
  );
  assert.deepEqual(
    rehearsalOptions(['--out-dir', 'unused', ...flags(order)]).scenes.map(({ id }) => id),
    order,
  );
});

test('M3 ordered run shares reservations and continues after cap, step limit and export refusal', {
  timeout: 120_000,
}, async (t) => {
  const out = scratch(t);
  const upstream = await countedUpstream(t, { status: 502, path: '/v1/chat/completions' });
  const dbFixture = await exportClassroom(t);
  const unanswered = await dbFixture.start(BAYES_DEMO_ID);
  const opening = await unanswered.open();
  const ask = await opening.toAsk();
  opening.stop();
  await dbFixture.close();
  const seen = [];
  const run = await runScenes(
    out,
    options().scenes,
    livePolicy,
    t.signal,
    async (scene, dir, settings, budget, signal) => {
      seen.push([scene.id, budget.total()]);
      if (scene.id === order[0]) {
        const post = budget.fetchFor(scene.id, upstream.endpoint);
        for (let i = 0; i < 35; i++) {
          const response = await post(upstream.endpoint, { method: 'POST' });
          assert.equal(response.status, 502);
          await response.text();
        }
        // Course generation fails on the last allowed request. Route through Chromium and the SDK,
        // so a 502 without a handoff is distinguished from a broken browser or cleanup.
        return captureScene(
          scene,
          dir,
          {
            ...settings,
            endpoint: upstream.endpoint,
            modelEnv: {
              STUDIO_MODEL_PROVIDER: 'openai-compatible',
              STUDIO_MODEL_ID: 'loop/m3-tutor',
              STUDIO_MODEL_BASE_URL: new URL('/v1', upstream.endpoint).href,
              OPENAI_COMPATIBLE_API_KEY: fauxKey,
            },
          },
          budget,
          signal,
        );
      }
      mkdirSync(dir);
      if (scene.id === order[1]) throw new SceneStop('step_limit', 'lesson_beat_limit');
      if (scene.id === order[2]) {
        copyFileSync(dbFixture.path, join(dir, 'studio.sqlite'));
        // Negative control for an incomplete SQLite capture sent to the real export boundary.
        exportScene(dir, scene, { sessionId: unanswered.id, step: ask.step_id }, settings);
        assert.fail('Expected export refusal');
      }
      throw new SceneStop('student_failed', 'student_generation_failed');
    },
  );
  assert.deepEqual(seen, [
    [order[0], 0],
    [order[1], 36],
    [order[2], 36],
    [order[3], 36],
  ]);
  assert.equal(upstream.received.length, 36);
  assert.deepEqual(
    run.results.map(({ scene, posts, status, reason }) => [scene, posts, status, reason]),
    [
      [order[0], 36, 'budget_exhausted', 'scene_post_limit'],
      [order[1], 0, 'step_limit', 'lesson_beat_limit'],
      [order[2], 0, 'export_rejected', 'no_student_interaction'],
      [order[3], 0, 'student_failed', 'student_generation_failed'],
    ],
  );
  assert.equal(run.totalPosts, 36);
  const reservations = ledger(join(out, 'post-ledger.jsonl')).filter(
    ({ event }) => event === 'reserved',
  );
  assert.deepEqual(
    reservations.map(({ seq }) => seq),
    Array.from({ length: 36 }, (_, i) => i + 1),
  );
  for (const result of run.results) {
    const rows = reservations.filter(({ scene }) => scene === result.scene);
    assert.deepEqual(
      rows.map(({ sceneSeq }) => sceneSeq),
      Array.from({ length: result.posts }, (_, i) => i + 1),
    );
    const dir = join(out, result.scene);
    assert.deepEqual(readJson(join(dir, 'result.json')), result);
  }
  assert.ok(!existsSync(join(out, order[2], 'export', 'plan.json')));
  assert.deepEqual(run.cells, []);
  assert.deepEqual(run.sessions, []);
});

test('M3 no_handoff below the cap does not abort remaining scenes', async (t) => {
  const out = scratch(t);
  const { results, totalPosts } = await runScenes(
    out,
    options().scenes,
    livePolicy,
    t.signal,
    async (_scene, dir) => {
      mkdirSync(dir);
      throw new SceneStop('no_handoff', 'ask_not_visible');
    },
  );
  assert.equal(totalPosts, 0);
  assert.deepEqual(
    results.map(({ scene }) => scene),
    order,
  );
  assert.ok(results.every(({ status }) => status === 'no_handoff'));
});

test('M3 a real faux question mismatch halts before the answer and next scene', {
  timeout: 60_000,
}, async (t) => {
  const out = scratch(t);
  const scenes = rehearsalOptions(['--out-dir', out]).scenes;
  await assert.rejects(
    runScenes(out, scenes, { mode: 'faux' }, t.signal, (scene, dir, settings, budget, signal) => {
      assert.equal(scene.id, transfer.id, 'Offline question mismatch must stop before C2');
      return captureScene(scene, dir, settings, budget, signal, (script) =>
        startScriptedModel(divergingOpening(script)),
      );
    }),
    { code: 'ERR_ASSERTION', actual: differentPrompt, expected: transfer.opening.next_ask.prompt },
  );
  assert.equal(
    ledger(join(out, 'post-ledger.jsonl')).filter(({ event }) => event === 'reserved').length,
    2,
  );
  assert.ok(!existsSync(join(out, order[0])));
});

test('M3 run-wide fuse takes precedence over a swallowed SDK error', async (t) => {
  const out = scratch(t);
  const { endpoint, received } = await countedUpstream(t);
  await assert.rejects(
    runScenes(
      out,
      options().scenes,
      { ...livePolicy, limit: 1 },
      t.signal,
      async (scene, dir, _settings, budget) => {
        mkdirSync(dir);
        const call = budget.fetchFor(scene.id, endpoint);
        await call(endpoint, { method: 'POST' });
        await call(endpoint, { method: 'POST' }).catch(() => undefined);
        throw new SceneStop('no_handoff', 'course_generation_failed');
      },
    ),
    /Model POST fuse: budget_exhausted/,
  );
  assert.equal(received.length, 1);
  assert.ok(!existsSync(join(out, order[1])));
});

test('M3 unexpected export operational error halts the run', async (t) => {
  const out = scratch(t);
  await assert.rejects(
    runScenes(out, options().scenes, livePolicy, t.signal, async (_scene, dir) => {
      mkdirSync(dir);
      return { sessionId: 'synthetic-missing-db', state: 'completed' };
    }),
    /Unexpected judge-export failure/,
  );
  assert.ok(!existsSync(join(out, order[1])));
});

test('M3 export guard scans both injected synthetic keys literally and keeps refusals value-free', {
  timeout: 45_000,
}, async (t) => {
  const studio = await exportClassroom(t);
  const out = scratch(t);
  const sessions = [];
  for (const key of Object.values(credentials)) {
    const session = await studio.start(BAYES_DEMO_ID, true);
    const stream = await session.open();
    const ask = await stream.toAsk();
    assert.equal((await session.answer(ask, { text: `学生误贴了 ${key}` })).ok, true);
    stream.stop();
    sessions.push(session.id);
  }
  await studio.close();
  for (const [index, sessionId] of sessions.entries()) {
    const dir = join(out, `${index}`);
    mkdirSync(dir);
    // The fixture intentionally contains a synthetic leak; the real exporter reads it read-only.
    copyFileSync(studio.path, join(dir, 'studio.sqlite'));
    await assert.rejects(async () => exportScene(dir, transfer, { sessionId }, livePolicy), {
      status: 'export_rejected',
      message: 'credential_detected',
    });
    assert.deepEqual(readJson(join(dir, 'export-receipt.json')), {
      exit: 1,
      refusal: 'credential_detected',
    });
    assert.ok(!existsSync(join(dir, 'export')));
  }
});
