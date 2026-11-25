import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  demoCourses,
  offlineLesson,
  type SessionQuality,
  type SessionTrace,
} from '@eduharness-studio/engine';
import { createServerApp } from '../apps/server/src/app.js';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { sessionDatabase } from '../apps/server/src/session-db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';

test('offline inspection is read-only, grades acknowledged frames and returns genuine SQLite transitions', async (t) => {
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  const app = createServerApp({ database });
  const store = createSessionStore(sessionDatabase(database.db), async () => {
    throw new Error('Offline sessions do not use the teacher planner');
  });
  const course = demoCourses[0];
  const lesson = course.units[0].lessons[0];
  const created = await store.start({
    courseId: course.id,
    lessonId: lesson.id,
    topic: course.topic,
    prepare: () => ({ script: offlineLesson(course, lesson) }),
    restart: false,
  });
  assert.ok('snapshot' in created);
  const { session_id: id, generation } = created.snapshot;
  const endpoint = `/api/sessions/${id}`;
  const quality = (body: object) =>
    app.request(`${endpoint}/quality`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await quality({ playedActions: [] })).status, 400);

  const stream = store.openStream(id, generation);
  assert.ok(stream && !('error' in stream));
  assert.equal(store.poll(stream).kind, 'beat');
  assert.equal(((await (await quality({})).json()) as SessionQuality).dialogue.turns.length, 0);
  assert.deepEqual(store.progress(id, { generation, last_played_step_id: 1 }), { ok: true });
  assert.equal(store.poll(stream).kind, 'beat');

  const response = await quality({});
  assert.equal(response.status, 200);
  const result = (await response.json()) as SessionQuality;
  assert.deepEqual(result, await (await quality({})).json());
  assert.deepEqual(
    result.dialogue.turns.map(({ evidenceStepIds }) => evidenceStepIds),
    [[1]],
  );
  assert.equal(result.ruler, 'e1-binary-v3');
  assert.equal(result.mode, 'offline-rules');
  assert.equal(Object.keys(result.answers).length, 19);
  assert.equal(Object.keys(result.scoring.scores).length, 6);
  const trace = (await (await app.request(`${endpoint}/xray`)).json()) as SessionTrace;
  assert.equal(trace.generation, generation);
  assert.deepEqual(
    trace.transitions.map(({ to }) => to),
    ['intake', 'diagnose', 'scaffold'],
  );
  assert.equal(trace.transitions.at(-1)?.step_id, 1);
  assert.equal(trace.queued[0].step_id, 2);
  assert.equal(trace.spans[0].name, 'lesson_script');
  assert.ok(trace.spans[0].durationMs >= 0);
});
