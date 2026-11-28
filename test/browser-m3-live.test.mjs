import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startLiveLoopback } from './m3/live-loopback.mjs';
import { cutAskMarker, cutMarker, privateDiagnosis } from './m3/scenarios/live-loopback-scenes.mjs';
import { fenceM3Tests, ledger, scratch } from './m3/test-loopback.mjs';
import { rehearsalOptions, runScenes } from './m3-rehearsal.mjs';

const sceneIds = ['C2-pressure', 'C1-transfer', 'C3-interrupt', 'C4-prereq'];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function options(out, mock, limit) {
  const { scenes } = rehearsalOptions([
    '--out-dir',
    out,
    '--live',
    ...sceneIds.flatMap((id) => ['--scene', id]),
  ]);
  return {
    scenes,
    settings: {
      mode: 'live',
      limit,
      endpoint: mock.endpoint,
      modelEnv: mock.env,
      exportEnv: {
        DEEPSEEK_API_KEY: mock.env.OPENAI_COMPATIBLE_API_KEY,
        OPENROUTER_API_KEY: 'SyntheticLiveLoopbackJudgeKey',
      },
    },
  };
}

function assertCredentialFree(path, credentials) {
  const bytes = readFileSync(path);
  for (const key of Object.values(credentials)) {
    assert.ok(key && !bytes.includes(key), `Credential in ${path}`);
  }
}

await fenceM3Tests();

test('M3 --live completes four free-form Chromium lessons and exports the full played trajectory offline', {
  timeout: 300_000,
}, async (t) => {
  const out = scratch(t);
  const mock = await startLiveLoopback(t);
  const { scenes, settings } = options(out, mock, 114);
  const run = await runScenes(out, scenes, settings, t.signal);
  mock.verify();
  assert.deepEqual(
    run.results.map(({ status }) => status),
    Array(4).fill('completed'),
  );
  assert.equal(run.cells.length, 4);
  assert.equal(run.sessions.length, 4);

  const file = join(out, 'post-ledger.jsonl');
  const reservations = ledger(file).filter(({ event }) => event === 'reserved');
  assert.equal(run.totalPosts, mock.received.length);
  assert.deepEqual(
    reservations.map(({ scene, actor }) => ({ scene, actor })),
    mock.received.map(({ scene, actor }) => ({ scene, actor })),
  );
  assert.deepEqual(
    reservations.map(({ seq }) => seq),
    reservations.map((_, i) => i + 1),
  );
  assertCredentialFree(file, settings.exportEnv);

  for (const [index, scene] of scenes.entries()) {
    const result = run.results[index];
    const dir = join(out, scene.id);
    const captured = readJson(join(dir, 'capture.json'));
    assert.equal(result.scene, scene.id);
    assert.ok(result.beats > 0 && result.beats <= 70);
    assert.equal(captured.beats, result.beats);
    assert.equal(captured.nonLoopbackRequests, 0);
    assert.equal(captured.consoleErrors, 0);
    assert.equal(captured.pageErrors, 0);
    assert.deepEqual(
      captured.checkpoints.slice(0, scene.livePhases.length).map(({ phase }) => phase),
      scene.livePhases,
    );
    assert.ok(captured.checkpoints.some(({ phase }) => phase === 'follow'));
    assert.equal(result.studentPosts, captured.checkpoints.length);
    const calls = reservations.filter((row) => row.scene === scene.id);
    assert.deepEqual(
      calls.map(({ sceneSeq }) => sceneSeq),
      calls.map((_, i) => i + 1),
    );
    assert.equal(result.studentPosts, calls.filter(({ actor }) => actor === 'student').length);
    assert.equal(result.teacherPosts, calls.filter(({ actor }) => actor === 'teacher').length);
    assert.equal(result.posts, result.studentPosts + result.teacherPosts);

    assert.deepEqual(readJson(join(dir, 'result.json')), result);
    assert.deepEqual(readJson(join(dir, 'export-receipt.json')), { exit: 0 });
    assert.deepEqual(readJson(join(dir, 'export', 'plan.json')).cells, [run.cells[index]]);
    assert.deepEqual(readJson(join(dir, 'export', 'manifest.json')).sessions, [
      run.sessions[index],
    ]);
    assert.equal(run.sessions[index].last_played_step_id, result.step);
    assert.equal(run.cells[index].transcript.length, result.publicTurns + 1);
    for (const artifact of [
      'studio.sqlite',
      'capture.json',
      'result.json',
      'export/plan.json',
      'export/manifest.json',
    ]) {
      assertCredentialFree(join(dir, artifact), settings.exportEnv);
    }
    if (scene.id === 'C3-interrupt') {
      assert.equal(captured.cut.step, 1);
      assert.ok(captured.cut.queued.length > 0);
      assert.ok(captured.cut.resumed > Math.max(...captured.cut.queued));
      const { turns } = captured.quality.dialogue;
      assert.equal(turns.filter(({ interrupted }) => interrupted).length, 1);
      assert.ok(
        turns.every(({ evidenceStepIds }) =>
          evidenceStepIds.every((id) => !captured.cut.queued.includes(id)),
        ),
      );
      for (const marker of [cutMarker, cutAskMarker, privateDiagnosis]) {
        assert.ok(!JSON.stringify(captured).includes(marker));
        assert.ok(!JSON.stringify(run.cells[index]).includes(marker));
      }
    }
  }
});

test('M3 --live total fuse blocks a real student model request before it reaches loopback', {
  timeout: 90_000,
}, async (t) => {
  const out = scratch(t);
  const mock = await startLiveLoopback(t);
  const { scenes, settings } = options(out, mock, 2);
  await assert.rejects(
    runScenes(out, scenes, settings, t.signal),
    /Model POST fuse: budget_exhausted/,
  );
  const [scene, next] = scenes;
  mock.verify([]);
  assert.deepEqual(
    mock.received.map(({ actor }) => actor),
    ['teacher', 'teacher'],
  );
  const file = join(out, 'post-ledger.jsonl');
  const rows = ledger(file);
  assert.deepEqual(
    rows.filter(({ event }) => event === 'reserved').map(({ actor }) => actor),
    ['teacher', 'teacher'],
  );
  assert.deepEqual(
    rows.filter(({ scope }) => scope === 'total').map(({ at, ...entry }) => entry),
    [
      {
        event: 'budget_exhausted',
        scene: scene.id,
        total: 2,
        actor: 'student',
        scope: 'total',
        limit: 2,
      },
    ],
  );
  assert.ok(!existsSync(join(out, next.id)));
  assertCredentialFree(file, settings.exportEnv);
});

test('M3 --live refuses an escaped credential on the played board before any student POST', {
  timeout: 90_000,
}, async (t) => {
  const out = scratch(t);
  // Separate from the teacher auth key: only the rehearsal and judge know this synthetic value.
  const key = 'SyntheticM3"quoted\\path\nlineEnd';
  const mock = await startLiveLoopback(t, {
    mapOpening(opening) {
      const [first, ...rest] = opening.panels;
      return { ...opening, panels: [{ ...first, content: `${first.content}\n${key}` }, ...rest] };
    },
  });
  const { scenes, settings } = options(out, mock, 114);
  settings.exportEnv.OPENROUTER_API_KEY = key;

  const [scene] = scenes;
  const run = await runScenes(out, [scene], settings, t.signal);
  assert.deepEqual(
    mock.received.map(({ actor }) => actor),
    ['teacher', 'teacher'],
  );
  mock.verify([]);
  assert.deepEqual(run.results, [
    {
      scene: scene.id,
      posts: 2,
      teacherPosts: 2,
      studentPosts: 0,
      status: 'student_failed',
      reason: 'unsafe_student_text',
    },
  ]);
  const reservations = ledger(join(out, 'post-ledger.jsonl')).filter(
    ({ event }) => event === 'reserved',
  );
  assert.ok(reservations.every(({ actor }) => actor === 'teacher'));
  assert.equal(reservations.length, 2);
  assert.deepEqual(run.cells, []);
  assert.ok(!existsSync(join(out, scene.id, 'export')));
});
