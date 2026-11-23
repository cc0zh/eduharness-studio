import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BAYES_DEMO_ID,
  demoCourses,
  offlineLesson,
  validateLessonScript,
} from '@eduharness-studio/engine';
import { createServerApp } from '../apps/server/src/app.js';
import { openStudioDatabase } from '../apps/server/src/db.js';

const retired = ['demo-point-line-distance', 'demo-http-cache'];

test('old bookmarks return an explicit retired response without deleting their data', async (t) => {
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  const insert = database.db.prepare(
    "INSERT INTO courses (id, topic, title, blueprint_json, created_at) VALUES (?, 'old', 'old', '{}', '2026-01-01')",
  );
  for (const id of retired) insert.run(id);
  const app = createServerApp({ database });
  const visible = (await (await app.request('/api/courses')).json()) as { id: string }[];
  assert.deepEqual(visible.map(({ id }) => id).sort(), demoCourses.map(({ id }) => id).sort());
  for (const id of retired) {
    for (const path of [
      `/api/courses/${id}`,
      `/api/demos/${id}/entry`,
      `/api/courses/${id}/lessons/u1-l1`,
    ]) {
      const response = await app.request(path);
      assert.equal(response.status, 410);
      assert.deepEqual(await response.json(), { error: 'demo_retired' });
    }
  }
  assert.equal((await app.request('/api/courses/demo-typo')).status, 404);
  assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM courses').get()?.count, 4);
});

test('old snapshots are not reinterpreted and four-column or unsafe SVG scripts are rejected', async (t) => {
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  database.db
    .prepare(
      "INSERT INTO sessions (id,course_id,lesson_id,state,snapshot_json,updated_at) VALUES ('old',?,'u1-l1','scaffold','{\"generation\":1}','2026-01-01')",
    )
    .run(BAYES_DEMO_ID);
  const app = createServerApp({ database });
  const id = `/api/courses/${BAYES_DEMO_ID}/lessons/u1-l1/sessions`;
  const active = await app.request(`${id}/active`);
  assert.equal(active.status, 410);
  assert.deepEqual(await active.json(), { error: 'session_retired' });
  assert.equal((await app.request(id, { method: 'POST' })).status, 410);
  const resume = await app.request('/api/sessions/old/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(resume.status, 410);
  assert.deepEqual(await resume.json(), { error: 'session_retired' });
  const oldStream = await app.request('/api/sessions/old/stream');
  assert.equal(oldStream.status, 410);
  assert.deepEqual(await oldStream.json(), { error: 'session_retired' });
  assert.equal((await app.request('/api/sessions/old/stream?generation=1')).status, 410);
  assert.ok(database.db.prepare("SELECT id FROM sessions WHERE id = 'old'").get());
  const restarted = await app.request(id, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restart: true }),
  });
  assert.equal(restarted.status, 201);
  const course = demoCourses[0];
  const script = offlineLesson(course, course.units[0].lessons[0]);
  const corrupt = script.actions.map((action) =>
    action.type === 'graph'
      ? { ...action, svg_markup: action.svg_markup.replace('<svg ', '<svg onload="alert(1)" ') }
      : action,
  );
  const historic = script.actions.map((action) =>
    'column' in action ? { ...action, column: 4 } : action,
  );
  assert.equal(validateLessonScript({ ...script, actions: corrupt }), false);
  assert.equal(validateLessonScript({ ...script, actions: historic }), false);
});
