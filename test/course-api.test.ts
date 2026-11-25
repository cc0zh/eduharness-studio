import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { type CourseBlueprint, demoCourses, offlineLesson } from '@eduharness-studio/engine';
import type { LessonMaterial } from '@eduharness-studio/engine/course';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
} from '@eduharness-studio/engine/models';
import { createServerApp } from '../apps/server/src/app.js';
import { createCourseStore } from '../apps/server/src/course-store.js';
import { openStudioDatabase } from '../apps/server/src/db.js';

const plan = {
  title: '模型构成的路线',
  units: [
    {
      title: '从数据出发',
      lessons: [
        { title: '观测样本', summary: '比较三个实际观测。', depth: 'intuition' },
        { title: '噪声边界', summary: '判断观测误差会怎样传播。', depth: 'definition' },
        { title: '局部变化', summary: '用变化率比较相邻点。', depth: 'derivation' },
      ],
    },
    {
      title: '检验迁移',
      lessons: [
        { title: '换域验证', summary: '把方法应用到新的测量场景。', depth: 'application' },
        { title: '误差复盘', summary: '分析误差来源与限制。', depth: 'theory' },
      ],
    },
  ],
};

const lesson = {
  keypoints: [
    { id: 'sample', title: '选择样本', objective: '区分观察值与真实规律。', depth: 'intuition' },
    { id: 'noise', title: '辨认噪声', objective: '识别数据中的测量误差。', depth: 'definition' },
  ],
  basis: {
    objective: '通过观测理解噪声对估计的影响。',
    examples: ['温度计误差'],
    misconceptions: ['把单次误差当成稳定规律'],
    sources: [{ id: 'model-knowledge', title: '统计学习基础', snippet: '误差与样本变化。' }],
  },
  opening: {
    diagnosis: { status: 'opening', summary: '先辨认观测。', strategy: '从一个样本开始。' },
    panels: [
      {
        title: '一次测量',
        content: '看一次测量，先不急着下结论。',
        highlight: '一次测量',
        voiceover: '同一个量反复测量，读数会完全相同吗？',
      },
    ],
    next_ask: { prompt: '多测几次会看到什么？' },
  },
};

function fixture(t: TestContext, online = true) {
  const directory = mkdtempSync(join(tmpdir(), 'eduharness-course-'));
  const database = openStudioDatabase(join(directory, 'studio.sqlite'));
  const faux = createFauxModelGateway();
  if (online)
    assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-only' }));
  const app = createServerApp({ database, modelGateway: faux.gateway });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  });
  const structured = (value: unknown) =>
    fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
  return { app, database, faux, structured };
}

test('live course generation stores dynamic lessons and coalesces a concurrent lesson unlock', async (t) => {
  const { app, database, faux, structured } = fixture(t);
  let begin: (() => void) | undefined;
  let release: (() => void) | undefined;
  let unlockPrompt = '';
  const generating = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  faux.setResponses([
    structured(plan),
    async (context) => {
      unlockPrompt = context.messages
        .flatMap(({ content }) => (typeof content === 'string' ? [content] : []))
        .join('\n');
      begin?.();
      await held;
      return structured(lesson);
    },
  ]);

  const created = await app.request('/api/intake/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: '传感器数据', foundation: 'familiar', goal: 'apply' }),
  });
  assert.equal(created.status, 201);
  const blueprint = await created.json();
  assert.equal(blueprint.units.length, 2);
  assert.equal(
    blueprint.units.reduce((count, unit) => count + unit.lessons.length, 0),
    5,
  );
  const allLessons = blueprint.units.flatMap((unit) => unit.lessons);
  assert.equal(allLessons[0].status, 'ready');
  assert.ok(allLessons.slice(1).every(({ status }) => status === 'locked'));

  const first = allLessons[1];
  const path = `/api/courses/${blueprint.id}/lessons/${first.id}/unlock`;
  const initialScript = offlineLesson(blueprint, allLessons[0]);
  const outcomes = initialScript.actions.filter((action) => action.type === 'keypoint_complete');
  const previousScript = {
    ...initialScript,
    actions: initialScript.actions.map((action) =>
      action.type === 'keypoint_complete' && action.keypoint_id === outcomes[1].keypoint_id
        ? { type: 'keypoint_unverified', step_id: action.step_id, keypoint_id: action.keypoint_id }
        : action,
    ),
  };
  database.db
    .prepare(
      'INSERT INTO sessions (id, course_id, lesson_id, state, last_played_step_id, snapshot_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      'in-progress-first-lesson',
      blueprint.id,
      allLessons[0].id,
      'diagnose',
      outcomes[1].step_id,
      JSON.stringify({ script: previousScript }),
      new Date().toISOString(),
    );
  const firstUnlock = app.request(path, { method: 'POST' });
  await generating;
  const secondUnlock = app.request(path, { method: 'POST' });
  await nextTurn();
  assert.equal(faux.state.callCount, 2);
  release?.();
  const responses = await Promise.all([firstUnlock, secondUnlock]);
  assert.deepEqual(
    responses.map(({ status }) => status),
    [200, 200],
  );
  assert.equal(faux.state.callCount, 2);
  const previous = unlockPrompt.match(
    /^Confirmed keypoints from preceding(?: completed)? lessons: (.+)$/m,
  );
  assert.ok(previous, unlockPrompt);
  assert.deepEqual(JSON.parse(previous[1]), [
    { ...initialScript.keypoints[0], status: 'completed' },
  ]);

  const refreshed = await app.request(`/api/courses/${blueprint.id}`);
  const persisted = await refreshed.json();
  assert.equal(persisted.units[0].lessons[1].status, 'ready');
  const stored = database.db
    .prepare('SELECT material_json FROM course_lessons WHERE course_id = ? AND lesson_id = ?')
    .get(blueprint.id, first.id) as { material_json: string } | undefined;
  assert.ok(stored);
  const material = JSON.parse(stored.material_json);
  assert.deepEqual(material.basis, lesson.basis);
  assert.equal(material.script.keypoints.length, 2);
  const [board, mark, caption, ask] = material.script.actions;
  assert.deepEqual(
    material.script.actions.map(({ type }) => type),
    ['board', 'highlight', 'speak', 'ask'],
  );
  assert.equal(mark.card_id, board.card_id);
  assert.equal(mark.target_text, lesson.opening.panels[0].highlight);
  assert.equal(caption.text, lesson.opening.panels[0].voiceover);
  assert.equal(ask.prompt, lesson.opening.next_ask.prompt);

  const started = await app.request(`/api/courses/${blueprint.id}/lessons/${first.id}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(started.status, 201);
  const session = (await started.json()) as { session_id: string };
  const snapshot = database.db
    .prepare('SELECT snapshot_json FROM sessions WHERE id = ?')
    .get(session.session_id) as { snapshot_json: string };
  const queue = JSON.parse(snapshot.snapshot_json);
  assert.deepEqual(queue.basis, lesson.basis);
  assert.deepEqual(queue.script, material.script);
  assert.ok(queue.teacher);

  const readyAgain = await app.request(path, { method: 'POST' });
  assert.equal(readyAgain.status, 200);
  assert.equal(faux.state.callCount, 2);
});

test('an unlocked live lesson reopens as a complete deterministic lesson after clearing BYOK', async (t) => {
  const { app, database, faux, structured } = fixture(t);
  faux.setResponses([structured(plan), structured(lesson)]);
  const generated = await app.request('/api/intake/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: '传感器数据', foundation: 'familiar', goal: 'apply' }),
  });
  assert.equal(generated.status, 201);
  const blueprint = await generated.json();
  const locked = blueprint.units
    .flatMap((unit) => unit.lessons)
    .find(({ status }) => status === 'locked');
  assert.ok(locked);
  const unlocked = await app.request(`/api/courses/${blueprint.id}/lessons/${locked.id}/unlock`, {
    method: 'POST',
  });
  assert.equal(unlocked.status, 200);

  faux.gateway.clearByok();
  const metadata = await app.request(`/api/courses/${blueprint.id}/lessons/${locked.id}`);
  assert.equal(metadata.status, 200);
  assert.deepEqual((await metadata.json()).keypoints, offlineLesson(blueprint, locked).keypoints);
  const started = await app.request(`/api/courses/${blueprint.id}/lessons/${locked.id}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(started.status, 201);
  const { session_id: sessionId } = (await started.json()) as { session_id: string };
  const queue = database.db
    .prepare('SELECT snapshot_json FROM sessions WHERE id = ?')
    .get(sessionId) as { snapshot_json: string };
  const snapshot = JSON.parse(queue.snapshot_json);
  assert.deepEqual(snapshot.script, offlineLesson(blueprint, locked));
  const ask = snapshot.script.actions.findIndex(({ type }) => type === 'ask');
  assert.ok(ask >= 0);
  assert.ok(snapshot.script.actions[ask + 1]?.step_id > snapshot.script.actions[ask].step_id);
  assert.equal(snapshot.teacher, undefined);
  assert.equal(faux.state.callCount, 2);
});

test('offline course unlock uses the deterministic lesson script without a model call', async (t) => {
  const { app, database, faux } = fixture(t, false);
  const created = await app.request('/api/intake/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: '线性插值', foundation: 'beginner', goal: 'understand' }),
  });
  const blueprint = await created.json();
  const locked = blueprint.units
    .flatMap((unit) => unit.lessons)
    .find(({ status }) => status === 'locked');
  assert.ok(locked);

  const response = await app.request(`/api/courses/${blueprint.id}/lessons/${locked.id}/unlock`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
  const material = database.db
    .prepare('SELECT material_json FROM course_lessons WHERE course_id = ? AND lesson_id = ?')
    .get(blueprint.id, locked.id) as { material_json: string } | undefined;
  assert.ok(material);
  assert.deepEqual(JSON.parse(material.material_json).script, offlineLesson(blueprint, locked));
  assert.equal(faux.state.callCount, 0);
});

test('demo entry stays offline and a demo follow-up does not reopen the first lesson or call the model', async (t) => {
  const { app, database, faux, structured } = fixture(t);
  faux.setResponses([structured(lesson)]);
  for (const course of demoCourses) {
    const [first, followUp] = course.units[0].lessons;
    const path = `/api/courses/${course.id}/lessons/${followUp.id}`;
    const response = await app.request(`${path}/unlock`, { method: 'POST' });
    assert.equal(response.status, 200);
    const started = await app.request(`${path}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(started.status, 201);
    const { session_id: id } = await started.json();
    const row = database.db.prepare('SELECT snapshot_json FROM sessions WHERE id = ?').get(id);
    const queue = JSON.parse(String(row?.snapshot_json));
    assert.notDeepEqual(queue.script, offlineLesson(course, first));
    assert.equal(queue.script.keypoints[0].objective, followUp.summary);
    assert.equal(queue.teacher, undefined);
  }
  assert.equal(faux.state.callCount, 0);
});

test('duplicate model keypoint IDs cannot unlock or persist a broken lesson', async (t) => {
  const { app, database, faux, structured } = fixture(t);
  const invalid = {
    ...lesson,
    keypoints: [lesson.keypoints[0], { ...lesson.keypoints[1], id: lesson.keypoints[0].id }],
  };
  const rejected = structured(invalid);
  faux.setResponses([structured(plan), rejected, rejected, rejected]);

  const generated = await app.request('/api/intake/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: '传感器数据', foundation: 'familiar', goal: 'apply' }),
  });

  assert.equal(generated.status, 201);
  const blueprint = await generated.json();
  const locked = blueprint.units
    .flatMap((unit) => unit.lessons)
    .find(({ status }) => status === 'locked');
  assert.ok(locked);
  const response = await app.request(`/api/courses/${blueprint.id}/lessons/${locked.id}/unlock`, {
    method: 'POST',
  });

  assert.equal(response.status, 502);
  assert.equal((await response.json()).failure, 'course_lesson_invalid_output');
  assert.equal(faux.state.callCount, 4);
  assert.equal(
    database.db.prepare('SELECT COUNT(*) AS count FROM courses WHERE id = ?').get(blueprint.id)
      ?.count,
    1,
  );
  assert.equal(
    database.db
      .prepare('SELECT blueprint_json FROM courses WHERE id = ?')
      .get(blueprint.id)
      ?.blueprint_json.includes('"status":"locked"'),
    true,
  );
  assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM course_lessons').get()?.count, 0);
});

test('course store rejects invalid material before writing it or marking the lesson ready', (t) => {
  const { database } = fixture(t);
  const store = createCourseStore(database);
  const blueprint: CourseBlueprint = { ...demoCourses[0], id: 'course-invalid-material' };
  const lockedId = blueprint.units[0].lessons[1].id;
  store.add(blueprint);
  const invalid = {
    script: offlineLesson(blueprint, blueprint.units[0].lessons[0]),
    openingEvidence: {
      diagnosis: { status: 'opening', summary: '开始', strategy: '观察' },
      durationMs: 1,
      guardrails: [{ attempt: 1, reasons: Array.from({ length: 21 }, () => 'rejected output') }],
    },
  } as unknown as LessonMaterial;

  assert.throws(
    () => store.saveMaterial(blueprint.id, lockedId, invalid),
    /invalid_lesson_material/,
  );
  const refreshed = store.get(blueprint.id);
  assert.equal(refreshed?.units[0].lessons[1].status, 'locked');
  assert.equal(store.material(blueprint.id, lockedId), undefined);
});
