import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { demoCourses, offlineLesson } from '@eduharness-studio/engine';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';

test('an active-session read keeps one SQLite snapshot across a concurrent worker commit', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'edu-session-snapshot-'));
  const path = join(directory, 'studio.sqlite');
  const database = openStudioDatabase(path);
  const signal = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const flag = new Int32Array(signal);
  const prepare = database.db.prepare.bind(database.db);
  let commitAnswer: (() => void) | undefined;
  database.db.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.includes("kind IN ('subtitle', 'answer', 'interrupt')")) {
      const all = statement.all.bind(statement);
      Object.defineProperty(statement, 'all', {
        value(id: string) {
          commitAnswer?.();
          return all(id);
        },
      });
    }
    return statement;
  };
  const sessions = createSessionStore(database);
  const course = demoCourses[0];
  const lesson = course.units[0].lessons[0];
  const started = sessions.start(
    course.id,
    lesson.id,
    course.topic,
    () => offlineLesson(course, lesson),
    false,
  );
  assert.ok(started.snapshot && !('error' in started.snapshot));
  const { session_id: id, generation } = started.snapshot;
  const active = sessions.openStream(id, generation);
  assert.ok(active && !('error' in active));
  let askStep: number | undefined;
  while (askStep === undefined) {
    const next = sessions.poll(active);
    assert.equal(next.kind, 'beat');
    const last_played_step_id = next.beat.action.step_id;
    assert.ok('ok' in sessions.progress(id, { generation, last_played_step_id }));
    if (next.beat.action.type === 'ask') askStep = last_played_step_id;
  }
  const worker = new Worker(
    `
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(workerData.path);
      db.exec('PRAGMA busy_timeout = 5000');
      const state = new Int32Array(workerData.signal);
      parentPort.once('message', ({ id, generation, askStep }) => {
        db.exec('BEGIN IMMEDIATE');
        db.prepare("UPDATE sessions SET snapshot_json = json_set(snapshot_json, '$.askStep', NULL) WHERE id = ?").run(id);
        db.prepare('INSERT INTO session_events (session_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)')
          .run(id, 'answer', JSON.stringify({ kind: 'answer', generation, ask_step_id: askStep, text: 'committed' }), new Date().toISOString());
        db.exec('COMMIT');
        Atomics.store(state, 0, 1);
        Atomics.notify(state, 0);
      });
    `,
    { eval: true, workerData: { path, signal } },
  );
  t.after(async () => {
    await worker.terminate();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    worker.once('online', resolve);
    worker.once('error', reject);
  });

  // Commit between the real active() read of the session and its read of the record rows.
  commitAnswer = () => {
    commitAnswer = undefined;
    worker.postMessage({ id, generation, askStep });
    assert.notEqual(Atomics.wait(flag, 0, 0, 5000), 'timed-out');
    assert.equal(Atomics.load(flag, 0), 1);
  };
  const before = sessions.active(course.id, lesson.id);
  assert.ok(before && !('error' in before));
  assert.equal(before.askStep, askStep);
  assert.ok(!before.records.some(({ kind }) => kind === 'answer'));
  const after = sessions.active(course.id, lesson.id);
  assert.ok(after && !('error' in after));
  assert.equal(after.askStep, null);
  assert.deepEqual(after.records.at(-1), {
    kind: 'answer',
    generation,
    ask_step_id: askStep,
    text: 'committed',
  });
});
