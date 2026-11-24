import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { demoCourses, offlineLesson } from '@eduharness-studio/engine';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
} from '@eduharness-studio/engine/models';
import { createTeacherPlanner } from '@eduharness-studio/engine/teacher';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';
import { makeFixture, opening, scaffold, startAtAsk } from './teacher-test-support.js';

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
  const store = createSessionStore(database, createTeacherPlanner(faux.gateway));
  const course = demoCourses[0];
  const lesson = course.units[0].lessons[0];
  const structured = (value: unknown) =>
    fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
  const script = offlineLesson(course, lesson);
  const start = () =>
    store.start({
      courseId: course.id,
      lessonId: lesson.id,
      topic: 'pairs',
      buildScript: () => script,
      restart: false,
      live: true,
    });
  faux.setResponses([structured(opening)]);
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

test('a rejected restart persists opening guardrail diagnostics without replacing the current session', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(opening)]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  const before = fixture.store.inspect(live.id)?.snapshot;
  assert.ok(before);
  const invalid = {
    ...opening,
    actions: [
      { type: 'board', column: 1, card_id: 'bad', content: '字数过长。'.repeat(45) },
      ...opening.actions.slice(1),
    ],
  };
  fixture.faux.setResponses([
    fixture.structured(invalid),
    fixture.structured(invalid),
    fixture.structured(invalid),
  ]);
  const restart = await fixture.store.start(fixture.options(true));
  assert.ok('error' in restart && restart.error === 'teacher_turn_failed');
  const after = fixture.store.inspect(live.id);
  assert.deepEqual(after?.snapshot, before);
  assert.deepEqual(
    after?.trace.teacherTurns.at(-1)?.guardrails.map(({ attempt }) => attempt),
    [1, 2, 3],
  );
  assert.equal(after?.trace.teacherTurns.at(-1)?.outcome, 'rejected');
});

test('a rejected first opening returns guardrail diagnostics without inserting a placeholder session', async (t) => {
  const fixture = makeFixture(t);
  const invalid = {
    ...opening,
    actions: [
      { type: 'board', column: 1, card_id: 'bad', content: '字数过长。'.repeat(45) },
      ...opening.actions.slice(1),
    ],
  };
  fixture.faux.setResponses([
    fixture.structured(invalid),
    fixture.structured(invalid),
    fixture.structured(invalid),
  ]);
  const started = await fixture.store.start(fixture.options(false));
  assert.ok('error' in started && started.error === 'teacher_turn_failed');
  const trace = 'trace' in started ? started.trace : undefined;
  assert.ok(trace);
  assert.deepEqual(
    trace.guardrails.map(({ attempt }) => attempt),
    [1, 2, 3],
  );
  assert.equal(trace.outcome, 'rejected');
  assert.equal(fixture.database.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n, 0);
});

test('opening retries preserve separate board and ask IDs and omit premature prerequisite insertion', async (t) => {
  const fixture = makeFixture(t);
  const invalid = {
    ...opening,
    insert_keypoint: {
      id: 'premature',
      title: '先备概念',
      objective: '理解如何分组',
      depth: 'intuition',
    },
    actions: [...opening.actions.slice(0, -1), { ...opening.actions.at(-1), card_id: 'open' }],
  };
  fixture.faux.setResponses([fixture.structured(invalid), fixture.structured(opening)]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  const inspection = fixture.store.inspect(live.id);
  assert.ok(inspection);
  assert.equal(live.ask.card_id, 'open-ask');
  assert.ok(
    inspection.snapshot.playedActions.some(
      (action) => action.type === 'highlight' && action.card_id === 'open',
    ),
  );
  assert.ok(!inspection.snapshot.keypoints?.some(({ id }) => id === 'premature'));
  const [turn] = inspection.trace.teacherTurns;
  assert.equal(turn.outcome, 'accepted');
  assert.deepEqual(turn.guardrails, [
    {
      attempt: 1,
      reasons: [
        'actions[3]: ask.card_id must be new and distinct from all board and ask cards, including cards from a truncated beat',
        'omit insert_keypoint on the opening turn',
      ],
    },
  ]);
});

test('first bare answer requests a two-choice scaffold without offering calculation or advancement', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(opening)]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  let prompt = '';
  let offeredTools: string[] | undefined;
  fixture.faux.setResponses([
    ({ messages }) => {
      const user = messages.find(({ role }) => role === 'user');
      prompt =
        typeof user?.content === 'string'
          ? user.content
          : (user?.content ?? [])
              .flatMap((part) => (part.type === 'text' ? [part.text] : []))
              .join('\n');
      offeredTools = messages.flatMap((message) =>
        message.role === 'system' ? (message.toolsAdded ?? []).map(({ name }) => name) : [],
      );
      return fixture.structured(scaffold);
    },
  ]);
  const receipt = await fixture.store.answer(live.id, {
    generation: live.generation,
    ask_step_id: live.ask.step_id,
    text: '1',
  });
  assert.ok('ok' in receipt, JSON.stringify(receipt));
  assert.match(prompt, /本轮是首次敷衍，不是跳过/);
  assert.match(prompt, /恰好两个简短、互斥的判断选项/);
  assert.doesNotMatch(prompt, /用 keypoint_unverified 标明/);
  assert.deepEqual(offeredTools, ['emit_result']);
  const second = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  assert.equal(second.ask.mode, 'choice');
  assert.equal(second.ask.mode === 'choice' && second.ask.options?.length, 2);
  assert.equal(second.ask.checkpoint, undefined);
  assert.equal(fixture.store.inspect(live.id)?.snapshot.keypoints?.[0].status, 'active');
  assert.equal(fixture.faux.state.callCount, 2);
});
