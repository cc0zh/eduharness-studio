import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { demoCourses, offlineLesson } from '@eduharness-studio/engine';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
} from '@eduharness-studio/engine/models';
import { createTeacherPlanner } from '@eduharness-studio/engine/teacher';
import { Type } from '@sinclair/typebox';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';

function output(status: string, actions: object[], insert?: object) {
  return {
    diagnosis: { status, summary: '检查配对是否完整。', strategy: '换数字再试一次。' },
    ...(insert ? { insert_keypoint: insert } : {}),
    actions,
  };
}

function opening() {
  return output('opening', [
    { type: 'board', column: 1, card_id: 'intro', content: '把五块积木尝试两两摆放。' },
    { type: 'speak', text: '先试着每两个摆成一组。' },
    { type: 'highlight', card_id: 'intro', target_text: '两两', style: 'circle' },
    { type: 'ask', card_id: 'intro-ask', mode: 'open', prompt: '五块积木两两配对，会剩几块？' },
  ]);
}

function scaffold() {
  return output('low_effort', [
    { type: 'board', column: 1, card_id: 'scaffold', content: '每组先放两块积木。' },
    { type: 'speak', text: '试着想象它们排成一行。' },
    { type: 'highlight', card_id: 'scaffold', target_text: '两块', style: 'highlight' },
    {
      type: 'ask',
      card_id: 'scaffold-ask',
      mode: 'choice',
      prompt: '五块分组后怎样？',
      options: [
        { id: 'left-one', label: '四块成两对，还剩一块' },
        { id: 'even', label: '全部恰好成对' },
      ],
    },
  ]);
}

function inserted() {
  return output(
    'missing_prereq',
    [
      { type: 'board', column: 1, card_id: 'pair-board', content: '两个相同的物件组成一对。' },
      { type: 'speak', text: '先拿出两块积木，看看它们怎样形成一对。' },
      { type: 'highlight', card_id: 'pair-board', target_text: '一对', style: 'circle' },
      { type: 'ask', card_id: 'pair-ask', mode: 'open', prompt: '四块积木可以分成几对？' },
    ],
    {
      id: 'pre-groups',
      title: '两两配对',
      objective: '把同类物件每两个分成一组',
      depth: 'intuition',
    },
  );
}

function unverified() {
  return output('low_effort', [
    { type: 'board', column: 1, card_id: 'review-one', content: '先回忆每两块成一对。' },
    { type: 'speak', text: '我们先带着这个线索继续。' },
    { type: 'keypoint_unverified', keypoint_id: 'pre-groups' },
    { type: 'board', column: 2, card_id: 'next-board', content: '现在看六块积木。' },
    { type: 'ask', card_id: 'next-ask', mode: 'open', prompt: '六块可以分成几对？' },
  ]);
}

function makeFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'eduharness-teacher-'));
  const path = join(directory, 'studio.sqlite');
  const database = openStudioDatabase(path);
  const faux = createFauxModelGateway();
  assert.ok(
    faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-mock-only' }),
  );
  const store = createSessionStore(database, createTeacherPlanner(faux.gateway));
  const source = demoCourses[0];
  const course = {
    ...source,
    id: 'course-teacher-mock',
    topic: '奇偶性',
    title: '奇偶性',
    units: [
      {
        ...source.units[0],
        lessons: [
          {
            ...source.units[0].lessons[0],
            id: 'lesson-teacher-mock',
            title: '奇偶性',
            summary: '通过配对理解奇偶性。',
          },
        ],
      },
    ],
  };
  const script = offlineLesson(course, course.units[0].lessons[0]);
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  });
  const structured = (value: unknown) =>
    fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
  const start = () =>
    store.start({
      courseId: course.id,
      lessonId: course.units[0].lessons[0].id,
      topic: course.topic,
      buildScript: () => script,
      restart: false,
      live: true,
    });
  return { database, path, faux, store, script, start, structured, course };
}

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
  fixture.faux.setResponses([fixture.structured(opening())]);
  const started = await fixture.start();
  assert.ok('snapshot' in started);
  const id = started.snapshot.session_id;
  const generation = started.snapshot.generation;
  const first = reachAsk(fixture.store, id, generation);

  fixture.faux.setResponses([fixture.structured(inserted())]);
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
      ['focus-1', 'pending'],
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

  fixture.faux.setResponses([fixture.structured(scaffold())]);
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

  fixture.faux.setResponses([fixture.structured(unverified())]);
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
      ['focus-1', 'active'],
    ],
  );
  const refreshedDb = openStudioDatabase(fixture.path);
  try {
    const restored = createSessionStore(refreshedDb).active(
      fixture.course.id,
      fixture.course.units[0].lessons[0].id,
    );
    assert.ok(restored && !('error' in restored));
    assert.equal(restored.session_id, id);
    assert.deepEqual(
      restored.keypoints?.map(({ id: point, status }) => [point, status]).slice(0, 2),
      [
        ['pre-groups', 'unverified'],
        ['focus-1', 'active'],
      ],
    );
  } finally {
    refreshedDb.close();
  }
});

test('a stale faux result cannot overwrite a session claimed while the model was pending', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(opening())]);
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
      return fixture.structured(scaffold());
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
    fixture.database,
    createTeacherPlanner(fixture.faux.gateway, tools),
  );
  fixture.faux.setResponses([
    fixture.structured({ tool: 'mock_sum', arguments: { amount: 2, api_key: 'input-secret' } }),
    fixture.structured(opening()),
  ]);
  const started = await sessions.start({
    courseId: fixture.course.id,
    lessonId: fixture.course.units[0].lessons[0].id,
    topic: fixture.course.topic,
    buildScript: () => fixture.script,
    restart: false,
    live: true,
  });
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
  faux.setResponses([structured(opening())]);
  const started = await start();
  assert.ok('snapshot' in started);
  const { session_id: id, generation } = started.snapshot;
  const { ask, stream } = reachAsk(store, id, generation);
  const before = store.inspect(id)?.snapshot;
  assert.ok(before);
  const wrong = structured({
    ...scaffold(),
    diagnosis: { status: 'mastered', summary: '假的过关。', strategy: '跳过检验。' },
  });
  faux.setResponses([wrong, wrong, wrong, structured(scaffold())]);
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
