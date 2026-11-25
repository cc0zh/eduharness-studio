import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  demoCourses,
  generateBlueprint,
  type Keypoint,
  offlineLesson,
  type SessionSnapshot,
} from '@eduharness-studio/engine';
import type { LessonMaterial } from '@eduharness-studio/engine/course';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
} from '@eduharness-studio/engine/models';
import { createServerApp } from '../apps/server/src/app.js';
import { createCourseStore } from '../apps/server/src/course-store.js';
import { openStudioDatabase } from '../apps/server/src/db.js';

const draft = {
  keypoints: [
    {
      id: 'daily',
      title: '比较每日高潮',
      objective: '从潮位记录辨认重复周期。',
      depth: 'intuition',
    },
    {
      id: 'lunar',
      title: '联系月球位置',
      objective: '用月球位置解释高潮时间的变化。',
      depth: 'definition',
    },
    {
      id: 'predict',
      title: '预测下一次高潮',
      objective: '用观测周期估算下次高潮。',
      depth: 'application',
    },
  ],
  basis: {
    objective: '从潮位读数推到一次预测。',
    examples: ['两天的港口潮位'],
    misconceptions: ['每次高潮都发生在同一钟点'],
  },
  opening: {
    diagnosis: { status: 'opening', summary: '从港口读数开始。', strategy: '并排对照两天的记录。' },
    panels: [
      { title: '港口潮位', content: '昨天 7:00，今天 7:48。', voiceover: '先对照两次高潮时间。' },
    ],
    next_ask: { prompt: '明天七点就出海，会遇到一样的潮位吗？' },
  },
} as const;
const structured = (value: unknown) =>
  fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
const keypoints: Keypoint[] = draft.keypoints.map((point, i) => ({
  ...point,
  status: i ? 'pending' : 'active',
}));
const post = (body: object = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'eduharness-lifecycle-'));
  const path = join(directory, 'studio.sqlite');
  const database = openStudioDatabase(path);
  const faux = createFauxModelGateway();
  const enableModel = () =>
    assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-only' }));
  const app = createServerApp({ database, modelGateway: faux.gateway });
  const course = generateBlueprint('course-tide', {
    topic: '潮汐与月球引力',
    foundation: 'beginner',
    goal: 'understand',
  });
  createCourseStore(database).add(course);
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  });
  return {
    app,
    database,
    path,
    course,
    faux,
    enableModel,
    lessonPath: `/api/courses/${course.id}/lessons/u1-l1`,
  };
}

test('published u1-l1 plans topic-specific metadata on demand instead of using the offline outline', async (t) => {
  const { app, enableModel, faux, lessonPath } = fixture(t);
  enableModel();
  faux.setResponses([structured(draft)]);
  const response = await app.request(lessonPath);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { keypoints });
  assert.equal(faux.state.callCount, 1);
});

test('u1-l1 coalesces entry points and persists one opening across SQLite connections', {
  timeout: 5000,
}, async (t) => {
  const { app, database, path, course, enableModel, faux, lessonPath } = fixture(t);
  enableModel();
  const otherDb = openStudioDatabase(path);
  try {
    const otherApp = createServerApp({ database: otherDb, modelGateway: faux.gateway });
    const entered = Promise.withResolvers<void>();
    const hold = Promise.withResolvers<void>();
    faux.setResponses([
      async ({ messages }) => {
        entered.resolve();
        const prompt = String(messages.find(({ role }) => role === 'user')?.content);
        assert.match(prompt, /Target lesson: .*"id":"u1-l1"/);
        assert.match(prompt, /Confirmed keypoints from preceding lessons: \[\]/);
        await hold.promise;
        return structured(draft);
      },
    ]);

    const start = app.request(`${lessonPath}/sessions`, post());
    await entered.promise;
    const metadata = app.request(lessonPath);
    const unlock = app.request(`${lessonPath}/unlock`, post());
    try {
      const busy = await otherApp.request(lessonPath);
      assert.equal(busy.status, 409);
      assert.deepEqual(await busy.json(), { error: 'teacher_turn_busy' });
      assert.equal(faux.state.callCount, 1);
      assert.equal(database.db.prepare('SELECT COUNT(*) AS n FROM course_lessons').get()?.n, 0);
    } finally {
      hold.resolve();
    }

    const [started, info, unlocked] = await Promise.all([start, metadata, unlock]);
    assert.equal(started.status, 201);
    assert.equal(info.status, 200);
    assert.equal(unlocked.status, 200);
    assert.deepEqual(await info.json(), { keypoints });
    const snapshot = (await started.json()) as SessionSnapshot;
    assert.deepEqual(snapshot.keypoints, keypoints);
    const saved = createCourseStore(otherDb).material(course.id, 'u1-l1');
    assert.ok(saved?.openingEvidence);
    assert.deepEqual(saved.basis, draft.basis);
    const queue = otherDb.db
      .prepare('SELECT snapshot_json FROM sessions WHERE id = ?')
      .get(snapshot.session_id);
    assert.deepEqual(JSON.parse(String(queue?.snapshot_json)).script, saved.script);
    assert.deepEqual(
      saved.script.actions.map(({ type }) => type),
      ['board', 'speak', 'ask'],
    );
    const [board, caption, ask] = saved.script.actions;
    assert.ok(board.type === 'board' && caption.type === 'speak' && ask.type === 'ask');
    assert.equal(board.content, draft.opening.panels[0].content);
    assert.equal(caption.text, draft.opening.panels[0].voiceover);
    assert.equal(ask.prompt, draft.opening.next_ask.prompt);
    assert.deepEqual(await (await otherApp.request(lessonPath)).json(), { keypoints });
    assert.deepEqual(
      await (await otherApp.request(`${lessonPath}/sessions/active`)).json(),
      snapshot,
    );

    const restarted = await otherApp.request(`${lessonPath}/sessions`, post({ restart: true }));
    assert.equal(restarted.status, 201);
    const fresh = (await restarted.json()) as SessionSnapshot;
    assert.notEqual(fresh.session_id, snapshot.session_id);
    assert.deepEqual(fresh.keypoints, snapshot.keypoints);
    assert.equal(faux.state.callCount, 1);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS n FROM course_lessons').get()?.n, 1);
    assert.deepEqual(createCourseStore(otherDb).material(course.id, 'u1-l1'), saved);
  } finally {
    otherDb.close();
  }
});

test('offline u1-l1 and curated demos keep deterministic outlines; an explicit live restart plans only the generated lesson', async (t) => {
  const { app, course, enableModel, faux, lessonPath } = fixture(t);
  const offline = offlineLesson(course, course.units[0].lessons[0]).keypoints;
  assert.deepEqual(await (await app.request(lessonPath)).json(), { keypoints: offline });
  const started = await app.request(`${lessonPath}/sessions`, post());
  assert.equal(started.status, 201);
  const previous = (await started.json()) as SessionSnapshot;
  assert.deepEqual(previous.keypoints, offline);

  enableModel();
  faux.setResponses([structured(draft)]);
  const unlocked = await app.request(`${lessonPath}/unlock`, post());
  assert.equal(unlocked.status, 200);
  assert.deepEqual(await unlocked.json(), { lessonId: 'u1-l1', status: 'ready' });
  assert.equal(
    faux.state.callCount,
    0,
    'an existing offline session never needs new material to unlock',
  );
  for (const demo of demoCourses) {
    const first = demo.units[0].lessons[0];
    const path = `/api/courses/${demo.id}/lessons/${first.id}`;
    const expected = offlineLesson(demo, first).keypoints;
    assert.deepEqual(await (await app.request(path)).json(), { keypoints: expected });
    const opened = await app.request(`${path}/sessions`, post());
    assert.equal(opened.status, 201);
    assert.deepEqual((await opened.json()).keypoints, expected);
  }
  assert.deepEqual(await (await app.request(lessonPath)).json(), { keypoints: offline });
  const same = await app.request(`${lessonPath}/sessions`, post());
  assert.equal(same.status, 200);
  assert.equal((await same.json()).session_id, previous.session_id);
  assert.equal(faux.state.callCount, 0);

  const live = await app.request(`${lessonPath}/sessions`, post({ restart: true }));
  assert.equal(live.status, 201);
  assert.deepEqual((await live.json()).keypoints, keypoints);
  faux.gateway.clearByok();
  assert.deepEqual(await (await app.request(lessonPath)).json(), { keypoints });
  const backOffline = await app.request(`${lessonPath}/sessions`, post({ restart: true }));
  assert.equal(backOffline.status, 201);
  assert.deepEqual((await backOffline.json()).keypoints, offline);
  assert.deepEqual(await (await app.request(lessonPath)).json(), { keypoints: offline });
  assert.equal(faux.state.callCount, 1);
});

test('invalid u1-l1 material returns a retryable error without a placeholder session or row', async (t) => {
  const { app, database, enableModel, faux, lessonPath } = fixture(t);
  enableModel();
  const short = structured({ ...draft, keypoints: draft.keypoints.slice(0, 1) });
  faux.setResponses([short, short, short, structured(draft)]);
  const stopped = await app.request(`${lessonPath}/sessions`, post());
  assert.equal(stopped.status, 502);
  const { error, failure, reasons } = await stopped.json();
  assert.equal(error, 'teacher_turn_failed');
  assert.equal(failure, 'course_lesson_invalid_output');
  assert.match(reasons.join(' '), /keypoints: too few items/);
  assert.equal(faux.state.callCount, 3);
  assert.equal(database.db.prepare('SELECT COUNT(*) AS n FROM course_lessons').get()?.n, 0);
  assert.equal(database.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n, 0);

  const retry = await app.request(`${lessonPath}/sessions`, post());
  assert.equal(retry.status, 201);
  assert.deepEqual((await retry.json()).keypoints, keypoints);
  assert.equal(faux.state.callCount, 4);
});

test('a ready later lesson reuses its stored five-point live material without replanning or overwriting', async (t) => {
  const { app, course, database, enableModel, faux } = fixture(t);
  const lesson = course.units[0].lessons[1];
  const path = `/api/courses/${course.id}/lessons/${lesson.id}`;
  const stored: LessonMaterial = {
    script: {
      keypoints: [
        ...keypoints,
        {
          id: 'survey',
          title: '比较两座港口',
          objective: '判断港口位置如何改变潮位。',
          depth: 'application',
          status: 'pending',
        },
        {
          id: 'limits',
          title: '判断天气影响',
          objective: '解释天气怎样改变观测值。',
          depth: 'theory',
          status: 'pending',
        },
      ],
      actions: [
        {
          type: 'board',
          step_id: 1,
          card_id: 'tide',
          column: 1,
          title: '潮位记录',
          content: '海港正记录潮位。',
        },
        {
          type: 'ask',
          step_id: 2,
          card_id: 'question',
          mode: 'open',
          prompt: '高潮记录有什么共同点？',
        },
      ],
    },
    openingEvidence: {
      diagnosis: { ...draft.opening.diagnosis, status: 'opening' },
      durationMs: 7,
      guardrails: [],
    },
  };
  const courses = createCourseStore(database);
  assert.equal(courses.saveMaterial(course.id, lesson.id, stored), true);
  const persisted = () =>
    database.db
      .prepare('SELECT material_json FROM course_lessons WHERE course_id = ? AND lesson_id = ?')
      .get(course.id, lesson.id);
  const before = persisted();
  assert.ok(before);
  enableModel();
  faux.setResponses([structured(draft)]);

  const info = await app.request(path);
  assert.equal(info.status, 200);
  assert.deepEqual(await info.json(), { keypoints: stored.script.keypoints });
  const open = await app.request(`${path}/sessions`, post());
  assert.equal(open.status, 201);
  assert.deepEqual((await open.json()).keypoints, stored.script.keypoints);
  assert.deepEqual(persisted(), before);
  assert.equal(faux.state.callCount, 0);
});

test('an unversioned u1-l1 waits for explicit restart without exposing a placeholder outline', async (t) => {
  const { app, course, database, enableModel, faux, lessonPath } = fixture(t);
  const unversioned = '{"generation":1}';
  database.db
    .prepare(`
    INSERT INTO sessions (id, course_id, lesson_id, state, snapshot_json, updated_at)
    VALUES ('retired-first', ?, 'u1-l1', 'scaffold', ?, '2026-01-01')
  `)
    .run(course.id, unversioned);
  enableModel();
  faux.setResponses([structured(draft)]);

  const info = await app.request(lessonPath);
  assert.equal(info.status, 200);
  assert.deepEqual(await info.json(), { keypoints: [] });
  const active = await app.request(`${lessonPath}/sessions/active`);
  assert.equal(active.status, 410);
  assert.deepEqual(await active.json(), { error: 'session_retired' });
  assert.equal((await app.request(`${lessonPath}/unlock`, post())).status, 200);
  assert.equal((await app.request(`${lessonPath}/sessions`, post())).status, 410);
  assert.equal(faux.state.callCount, 0);

  const restart = await app.request(`${lessonPath}/sessions`, post({ restart: true }));
  assert.equal(restart.status, 201);
  assert.deepEqual((await restart.json()).keypoints, keypoints);
  assert.equal(faux.state.callCount, 1);
  assert.equal(
    database.db.prepare("SELECT snapshot_json FROM sessions WHERE id = 'retired-first'").get()
      ?.snapshot_json,
    unversioned,
  );
});
