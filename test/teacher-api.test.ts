import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@eduharness-studio/engine/models';
import { createTeacherPlanner } from '@eduharness-studio/engine/teacher';
import { Type } from '@sinclair/typebox';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { sessionDatabase } from '../apps/server/src/session-db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';
import { afterSkip, lessonDraft, makeFixture, scaffold } from './teacher-test-support.js';

const inserted = {
  diagnosis: {
    status: 'missing_prereq',
    summary: '分组概念尚未建立。',
    strategy: '先认识一对物件。',
  },
  insert_keypoint: {
    id: 'pre-groups',
    title: '两两配对',
    objective: '把同类物件每两个分成一组',
    depth: 'intuition',
  },
  panels: [
    {
      title: '先认识配对',
      content: '两个相同的物件组成一对。',
      highlight: '一对',
      voiceover: '先拿出两块积木，看看它们怎样形成一对。',
    },
  ],
  next_ask: { prompt: '四块积木可以分成几对？' },
};

function reachAsk(store: ReturnType<typeof createSessionStore>, id: string, generation: number) {
  const stream = store.openStream(id, generation);
  assert.ok(stream && !('error' in stream));
  for (let step = 0; step < 32; step += 1) {
    const result = store.poll(stream);
    assert.equal(result.kind, 'beat');
    if (result.kind !== 'beat') throw new Error('Expected one lesson beat');
    assert.ok(
      'ok' in store.progress(id, { generation, last_played_step_id: result.beat.action.step_id }),
    );
    if (result.beat.action.type === 'ask') return { stream, ask: result.beat.action };
  }
  throw new Error('Lesson never reached ask');
}

test('SQLite teacher turns insert prerequisites atomically, downgrade low effort, and restore unverified progress', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(lessonDraft())]);
  const started = await fixture.start();
  assert.ok('snapshot' in started);
  const id = started.snapshot.session_id;
  const generation = started.snapshot.generation;
  const first = reachAsk(fixture.store, id, generation);

  fixture.faux.setResponses([fixture.structured(inserted)]);
  const insertion = await fixture.store.answer(id, {
    generation,
    ask_step_id: first.ask.step_id,
    text: '我卡住了，前置知识不懂。',
  });
  assert.ok('keypoints' in insertion && insertion.keypoints);
  assert.deepEqual(
    insertion.keypoints.map(({ id: point, status }) => [point, status]).slice(0, 2),
    [
      ['pre-groups', 'active'],
      ['leftover', 'pending'],
    ],
  );
  assert.equal(
    fixture.database.db
      .prepare(
        "SELECT COUNT(*) AS n FROM session_events WHERE session_id = ? AND kind = 'teacher-turn'",
      )
      .get(id)?.n,
    2,
  );
  const second = reachAsk(fixture.store, id, generation);

  fixture.faux.setResponses([fixture.structured(scaffold)]);
  const downgraded = await fixture.store.answer(id, {
    generation,
    ask_step_id: second.ask.step_id,
    text: '１',
  });
  assert.ok('keypoints' in downgraded);
  const third = reachAsk(fixture.store, id, generation);
  assert.equal(third.ask.mode, 'choice');
  if (third.ask.mode !== 'choice') throw new Error('Expected the first low-effort choice ask');
  assert.equal(third.ask.options?.length, 2);

  fixture.faux.setResponses([fixture.structured(afterSkip)]);
  const skipped = await fixture.store.answer(id, {
    generation,
    ask_step_id: third.ask.step_id,
    text: '继续',
  });
  assert.ok('keypoints' in skipped);
  assert.equal(
    skipped.keypoints?.[0].status,
    'active',
    'an unplayed planned outcome is not yet classroom evidence',
  );
  const pendingSkip = fixture.store.inspect(id)?.trace;
  const plannedSkip = pendingSkip?.teacherTurns?.at(-1);
  assert.ok(plannedSkip?.unverifiedStepId);
  assert.equal(pendingSkip?.playedStepIds?.includes(plannedSkip.unverifiedStepId), false);
  reachAsk(fixture.store, id, generation);
  const playedSkip = fixture.store.inspect(id)?.trace;
  assert.equal(playedSkip?.playedStepIds?.includes(plannedSkip.unverifiedStepId), true);
  const acknowledged = fixture.store.active(
    fixture.course.id,
    fixture.course.units[0].lessons[0].id,
  );
  assert.ok(acknowledged && !('error' in acknowledged));
  assert.deepEqual(
    acknowledged.keypoints?.map(({ id: point, status }) => [point, status]).slice(0, 2),
    [
      ['pre-groups', 'unverified'],
      ['leftover', 'active'],
    ],
  );
  const refreshedDb = openStudioDatabase(fixture.path);
  try {
    const restored = createSessionStore(sessionDatabase(refreshedDb.db)).active(
      fixture.course.id,
      fixture.course.units[0].lessons[0].id,
    );
    assert.ok(restored && !('error' in restored));
    assert.equal(restored.session_id, id);
    assert.deepEqual(
      restored.keypoints?.map(({ id: point, status }) => [point, status]).slice(0, 2),
      [
        ['pre-groups', 'unverified'],
        ['leftover', 'active'],
      ],
    );
  } finally {
    refreshedDb.close();
  }
});

test('a stale faux result cannot overwrite a session claimed while the model was pending', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(lessonDraft())]);
  const started = await fixture.start();
  assert.ok('snapshot' in started);
  const { session_id: id, generation } = started.snapshot;
  const { ask } = reachAsk(fixture.store, id, generation);
  let begin: (() => void) | undefined;
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  fixture.faux.setResponses([
    async () => {
      begin?.();
      await held;
      return fixture.structured(scaffold);
    },
  ]);
  const answer = fixture.store.answer(id, { generation, ask_step_id: ask.step_id, text: '继续' });
  await waiting;
  assert.deepEqual(
    await fixture.store.answer(id, { generation, ask_step_id: ask.step_id, text: '继续' }),
    { error: 'teacher_turn_busy' },
  );
  const claimed = fixture.store.resume(id, {});
  assert.ok(claimed && !('error' in claimed));
  if (!claimed || 'error' in claimed) throw new Error('Expected the new playback claim');
  release?.();
  assert.deepEqual(await answer, { error: 'stale_generation' });
  assert.equal(
    fixture.store.active(fixture.course.id, fixture.course.units[0].lessons[0].id)?.generation,
    generation + 1,
  );
  assert.equal(fixture.faux.state.callCount, 2);
});

test('tool trace spans stay redacted at the SQLite boundary', async (t) => {
  const fixture = makeFixture(t);
  const tools = [
    {
      name: 'mock_sum',
      description: 'Offline faux-only tool.',
      parameters: Type.Object({ amount: Type.Number(), api_key: Type.String() }),
      run: ({ amount }: { amount: number }) => ({
        sum: amount + amount,
        api_key: 'result-secret',
        note: 'hidden',
      }),
    },
  ];
  const sessions = createSessionStore(
    sessionDatabase(fixture.database.db),
    createTeacherPlanner(fixture.faux.gateway, tools),
  );
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('mock_sum', { amount: 2, api_key: 'input-secret' }), {
      stopReason: 'toolUse',
    }),
    fixture.structured(lessonDraft()),
  ]);
  const started = await sessions.start(fixture.options(false, true, tools));
  assert.ok('snapshot' in started);
  const trace = sessions.inspect(started.snapshot.session_id)?.trace;
  assert.ok(trace);
  assert.deepEqual(
    trace.spans.filter(({ kind }) => kind === 'tool').map(({ input, result }) => [input, result]),
    [[{ amount: 2 }, { sum: 4, note: '[已隐藏]' }]],
  );
  assert.equal(JSON.stringify(trace).includes('input-secret'), false);
  assert.equal(JSON.stringify(trace).includes('result-secret'), false);
});

test('exhausted replans keep the confirmed classroom and record the rejection', async (t) => {
  const { start, store, faux, structured } = makeFixture(t);
  faux.setResponses([structured(lessonDraft())]);
  const started = await start();
  assert.ok('snapshot' in started);
  const { session_id: id, generation } = started.snapshot;
  const { ask, stream } = reachAsk(store, id, generation);
  const before = store.inspect(id)?.snapshot;
  assert.ok(before);
  const wrong = structured({
    ...scaffold,
    resolution: { text: '还没有展示迁移题。', conclusion: '不应提前过关。' },
  });
  faux.setResponses([wrong, wrong, wrong, structured(scaffold)]);
  const answer = { generation, ask_step_id: ask.step_id, text: '直接讲' };
  const failed = await store.answer(id, answer);
  assert.ok('error' in failed && failed.error === 'teacher_turn_failed');
  const rejected = store.inspect(id);
  assert.deepEqual(rejected?.snapshot, before);
  assert.deepEqual(store.poll(stream), { kind: 'waiting' });
  const trace = rejected?.trace.teacherTurns?.at(-1);
  assert.equal(trace?.outcome, 'rejected');
  assert.deepEqual(
    trace?.guardrails.map(({ attempt }) => attempt),
    [1, 2, 3],
  );
  assert.equal(faux.state.callCount, 4);
  assert.ok('ok' in (await store.answer(id, answer)));
  assert.equal(store.poll(stream).kind, 'beat');
});
