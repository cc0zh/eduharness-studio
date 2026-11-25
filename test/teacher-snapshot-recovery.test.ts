import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { demoCourses } from '@eduharness-studio/engine';
import { createCourseLessonPlanner } from '@eduharness-studio/engine/course';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
} from '@eduharness-studio/engine/models';
import { createTeacherPlanner } from '@eduharness-studio/engine/teacher';
import { KindGuard } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { sessionDatabase } from '../apps/server/src/session-db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';
import { lessonDraft, makeFixture, opening, scaffold, startAtAsk } from './teacher-test-support.js';

test('a duplicate-answer receipt never mixes an old session with a newer SQLite answer', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'eduharness-teacher-receipt-'));
  const path = join(directory, 'studio.sqlite');
  const database = openStudioDatabase(path);
  const beforeAnswerRead = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  let race: (() => void) | undefined;
  const prepare = database.db.prepare.bind(database.db);
  database.db.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.includes('SELECT payload_json FROM session_events WHERE session_id = ? AND kind = ?')) {
      const get = statement.get.bind(statement);
      Object.defineProperty(statement, 'get', {
        value(...parameters: unknown[]) {
          if (parameters[1] === 'answer') race?.();
          return get(...parameters);
        },
      });
    }
    return statement;
  };
  const faux = createFauxModelGateway();
  assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-only' }));
  const store = createSessionStore(
    sessionDatabase(database.db),
    createTeacherPlanner(faux.gateway),
  );
  const course = demoCourses[0];
  const lesson = course.units[0].lessons[0];
  const structured = (value: unknown) =>
    fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
  const plan = createCourseLessonPlanner(faux.gateway);
  const start = () =>
    store.start({
      courseId: course.id,
      lessonId: lesson.id,
      topic: 'pairs',
      prepare: async () => (await plan({ course, lesson, previousKeypoints: [] })).material,
      restart: false,
    });
  faux.setResponses([structured(lessonDraft())]);
  const live = await startAtAsk(store, start);
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(workerData.path);
    db.exec('PRAGMA busy_timeout = 5000');
    const signal = new Int32Array(workerData.signal);
    parentPort.once('message', ({ id, generation, askStep }) => {
      db.exec('BEGIN IMMEDIATE');
      const row = db.prepare('SELECT snapshot_json FROM sessions WHERE id = ?').get(id);
      const queue = JSON.parse(row.snapshot_json);
      queue.askStep = null;
      queue.script.keypoints.unshift({ id: 'cross-worker', title: '额外前置', objective: '检查跨连接收据', depth: 'intuition', status: 'active' });
      queue.teacher.insertedCount += 1;
      db.prepare("UPDATE sessions SET state = 'diagnose', snapshot_json = ? WHERE id = ?").run(JSON.stringify(queue), id);
      db.prepare('INSERT INTO session_events (session_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)')
        .run(id, 'answer', JSON.stringify({ kind: 'answer', generation, ask_step_id: askStep, text: 'the earlier answer' }), new Date().toISOString());
      db.exec('COMMIT');
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0);
      parentPort.postMessage('committed');
      db.close();
    });
  `,
    { eval: true, workerData: { path, signal: beforeAnswerRead.buffer } },
  );
  await new Promise<void>((resolve, reject) => {
    worker.once('online', resolve);
    worker.once('error', reject);
  });
  t.after(async () => {
    await worker.terminate();
    database.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  });
  let committed = false;
  race = () => {
    if (committed) return;
    committed = true;
    worker.postMessage({ id: live.id, generation: live.generation, askStep: live.ask.step_id });
    assert.notEqual(Atomics.wait(beforeAnswerRead, 0, 0, 5000), 'timed-out');
  };
  const answer = {
    generation: live.generation,
    ask_step_id: live.ask.step_id,
    text: 'the earlier answer',
  };
  assert.deepEqual(await store.answer(live.id, answer), { error: 'stale_generation' });
  race = undefined;
  const retry = await store.answer(live.id, answer);
  assert.ok('keypoints' in retry && retry.keypoints);
  assert.equal(retry.keypoints[0].id, 'cross-worker');
  assert.equal(faux.state.callCount, 1, 'the stale read must not launch a second model request');
});

const revealingOpening = {
  ...opening,
  panels: [{ ...opening.panels[0], voiceover: '正确答案是剩下一块。' }],
};

test('an invalid live preparation cannot replace the current offline session on restart', async (t) => {
  const fixture = makeFixture(t);
  const offline = await startAtAsk(fixture.store, () =>
    fixture.store.start(fixture.options(false, false)),
  );
  const before = fixture.store.inspect(offline.id);
  assert.ok(before);
  const rejected = fixture.structured(lessonDraft(revealingOpening));
  fixture.faux.setResponses([rejected, rejected, rejected]);
  await assert.rejects(fixture.store.start(fixture.options(true)), {
    code: 'course_lesson_invalid_output',
  });
  assert.deepEqual(fixture.store.inspect(offline.id), before);
  assert.equal(fixture.faux.state.callCount, 3);
});

test('opening schema retries a forbidden prerequisite insertion without persisting it', async (t) => {
  const fixture = makeFixture(t);
  const invalid = {
    ...opening,
    insert_keypoint: {
      id: 'premature',
      title: '先备概念',
      objective: '理解如何分组',
      depth: 'intuition',
    },
  };
  const noisyOpening = {
    ...opening,
    panels: [{ ...opening.panels[0], formula: ' ', draft_note: 'fixture-only drafting note' }],
    next_ask: { ...opening.next_ask, hint: null },
  };
  fixture.faux.setResponses([
    fixture.structured(lessonDraft(invalid)),
    fixture.structured(lessonDraft(noisyOpening)),
  ]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  const inspection = fixture.store.inspect(live.id);
  assert.ok(inspection);
  const [board, highlight, voiceover, ask] = inspection.snapshot.playedActions;
  assert.deepEqual(
    inspection.snapshot.playedActions.map(({ type }) => type),
    ['board', 'highlight', 'speak', 'ask'],
  );
  assert.ok(board.type === 'board' && highlight.type === 'highlight' && voiceover.type === 'speak');
  assert.equal(highlight.card_id, board.card_id);
  assert.equal(highlight.target_text, opening.panels[0].highlight);
  assert.equal(voiceover.text, opening.panels[0].voiceover);
  assert.deepEqual(ask, live.ask);
  assert.equal(live.ask.prompt, opening.next_ask.prompt);
  assert.notEqual(live.ask.card_id, board.card_id);
  assert.equal('formula' in board || 'hint' in live.ask, false);
  assert.equal(JSON.stringify(inspection).includes('fixture-only drafting note'), false);
  assert.ok(!inspection.snapshot.keypoints?.some(({ id }) => id === 'premature'));
  const [turn] = inspection.trace.teacherTurns;
  assert.equal(turn.outcome, 'accepted');
  assert.deepEqual(turn.guardrails, [
    {
      attempt: 1,
      reasons: [
        'model_invalid_output: invalid structured output at $.opening.insert_keypoint: unexpected field',
      ],
    },
  ]);
});

test('first bare answer requests a two-choice scaffold without offering calculation or advancement', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(lessonDraft())]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  let prompt = '';

  fixture.faux.setResponses([
    ({ messages }) => {
      const user = messages.find(({ role }) => role === 'user');
      prompt =
        typeof user?.content === 'string'
          ? user.content
          : (user?.content ?? [])
              .flatMap((part) => (part.type === 'text' ? [part.text] : []))
              .join('\n');
      const tools = messages.flatMap((message) =>
        message.role === 'system' ? (message.toolsAdded ?? []) : [],
      );
      assert.deepEqual(
        tools.map(({ name }) => name),
        ['emit_result'],
      );
      const schema = tools[0].parameters;
      assert.ok(KindGuard.IsSchema(schema));
      assert.equal(Value.Check(schema, { value: scaffold }), true);
      for (const value of [
        { ...scaffold, diagnosis: { ...scaffold.diagnosis, status: 'clarifying' } },
        { ...scaffold, next_ask: { ...scaffold.next_ask, options: ['一项', '二项', '三项'] } },
        { ...scaffold, next_ask: { prompt: scaffold.next_ask.prompt } },
        { ...scaffold, next_ask: { ...scaffold.next_ask, transfer: true } },
        { ...scaffold, resolution: { text: '不应过关', conclusion: '不应产生结论' } },
      ])
        assert.equal(Value.Check(schema, { value }), false);
      return fixture.structured(scaffold);
    },
  ]);
  const receipt = await fixture.store.answer(live.id, {
    generation: live.generation,
    ask_step_id: live.ask.step_id,
    text: '1',
  });
  assert.ok('ok' in receipt, JSON.stringify(receipt));
  const policy = prompt.split('课堂输入：')[0];
  assert.match(policy, /low_effort/);
  assert.match(policy, /首次敷衍.*不是跳过/);
  assert.match(policy, /next_ask\.options.*(?:2 项|两个).*互斥/);
  assert.doesNotMatch(
    policy,
    /\b(?:actions|checkpoint|keypoint_unverified|keypoint_complete|card_id)\b/,
  );
  const second = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  assert.equal(second.ask.mode, 'choice');
  assert.equal(second.ask.mode === 'choice' && second.ask.options?.length, 2);
  assert.equal(second.ask.checkpoint, undefined);
  assert.equal(fixture.store.inspect(live.id)?.snapshot.keypoints?.[0].status, 'active');
  assert.equal(fixture.faux.state.callCount, 2);
});
