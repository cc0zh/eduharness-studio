import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BAYES_DEMO_ID,
  type CourseBlueprint,
  demoCourses,
  type LessonScript,
  offlineLesson,
  validateActions,
  validateBlueprint,
  validateLessonScript,
} from '@eduharness-studio/engine';
import { createServerApp } from '../apps/server/src/app.js';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';

const legacyCourses: readonly CourseBlueprint[] = [
  {
    id: 'demo-point-line-distance',
    title: '点到直线的距离',
    topic: '几何推理',
    units: [
      {
        id: 'u1',
        title: '从图形到坐标',
        lessons: [
          {
            id: 'u1-l1',
            title: '在坐标里找垂距',
            summary: '区分斜线段和直线距离。',
            depth: 'intuition',
            status: 'ready',
          },
          {
            id: 'u1-l2',
            title: '找到垂足再计算',
            summary: '写出垂足的坐标。',
            depth: 'derivation',
            status: 'locked',
          },
        ],
      },
    ],
  },
  {
    id: 'demo-http-cache',
    title: 'HTTP 缓存：为什么不用重下？',
    topic: 'Web 技术',
    units: [
      {
        id: 'u1',
        title: '一次访问，两种判断',
        lessons: [
          {
            id: 'u1-l1',
            title: '浏览器什么时候复用资源？',
            summary: '区分“还能用”和“先去问服务器”。',
            depth: 'intuition',
            status: 'ready',
          },
        ],
      },
    ],
  },
];

test('SQLite upgrade hides retired demos from the home list but preserves bookmarked direct starts', async (t) => {
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  const insert = database.db.prepare(
    'INSERT INTO courses (id, topic, title, blueprint_json, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const timestamp = new Date().toISOString();
  for (const course of legacyCourses) {
    insert.run(course.id, course.topic, course.title, JSON.stringify(course), timestamp);
  }

  const app = createServerApp({ database });
  const list = await app.request('/api/courses');
  assert.equal(list.status, 200);
  const visible = (await list.json()) as { id: string; kind: string }[];
  assert.deepEqual(visible.map(({ id }) => id).sort(), [BAYES_DEMO_ID, 'demo-transformer'].sort());
  assert.ok(visible.every(({ kind }) => kind === 'demo'));

  for (const legacy of legacyCourses) {
    const blueprintResponse = await app.request(`/api/courses/${legacy.id}`);
    assert.equal(blueprintResponse.status, 200);
    const blueprint = validateBlueprint(await blueprintResponse.json());
    assert.ok(blueprint.ok);
    assert.equal(blueprint.blueprint.title, legacy.title);

    const start = await app.request(`/api/courses/${legacy.id}/lessons/u1-l1/sessions`, {
      method: 'POST',
    });
    assert.equal(start.status, 201);
    const { session_id } = (await start.json()) as { session_id: string };
    const row = database.db
      .prepare('SELECT snapshot_json FROM sessions WHERE id = ?')
      .get(session_id);
    assert.ok(row && typeof row.snapshot_json === 'string');
    const snapshot = JSON.parse(row.snapshot_json) as { script: LessonScript };
    assert.ok(validateLessonScript(snapshot.script));
    assert.ok(validateActions(snapshot.script.actions).ok);
    assert.deepEqual(
      snapshot.script.keypoints.map(({ id }) => id),
      legacy.id === 'demo-point-line-distance'
        ? ['foot', 'measure', 'transfer']
        : ['reuse', 'fresh', 'tag', 'compare', 'policy'],
    );
  }
});

test('session restore rejects stored SVGs outside the shared whitelist and accepts historic columns', () => {
  const database = openStudioDatabase(':memory:');
  try {
    const sessions = createSessionStore(database);
    const lesson = offlineLesson(demoCourses[0], demoCourses[0].units[0].lessons[0]);
    const corrupted = {
      ...lesson,
      actions: lesson.actions.map((action) =>
        action.type === 'graph'
          ? { ...action, svg_markup: action.svg_markup.replace('<svg ', '<svg onload="alert(1)" ') }
          : action,
      ),
    };
    assert.equal(validateLessonScript(corrupted), false);
    const rejectedId = sessions.create('course-test', 'lesson-test', corrupted);
    assert.throws(() => sessions.openStream(rejectedId), /Invalid stored lesson session/);

    const historic = {
      ...lesson,
      actions: lesson.actions.map((action) =>
        action.type === 'board' || action.type === 'graph' || action.type === 'new_column'
          ? { ...action, column: Math.max(4, action.column) }
          : action,
      ),
    };
    assert.equal(validateLessonScript(historic), true);
    const historicId = sessions.create('demo-point-line-distance', 'u1-l1', historic);
    const stream = sessions.openStream(historicId);
    assert.ok(stream);
    const first = sessions.poll(stream);
    assert.equal(first.kind, 'beat');
    if (first.kind === 'beat') {
      assert.equal(first.beat.action.type, 'board');
      assert.equal(first.beat.action.column, 4);
    }
  } finally {
    database.close();
  }
});
