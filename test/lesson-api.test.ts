import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { BAYES_DEMO_ID, readLessonBeat, readLessonGeneration } from '@eduharness-studio/engine';
import { createServerApp } from '../apps/server/src/app.js';
import { openStudioDatabase } from '../apps/server/src/db.js';

const lessonPath = `/api/courses/${BAYES_DEMO_ID}/lessons/u1-l1`;

test('lesson API: a new stream replays the unplayed beat, rejects stale writes, and waits for an answer', {
  timeout: 12_000,
}, async (t) => {
  const database = openStudioDatabase(':memory:');
  const app = createServerApp({ database });
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  t.after(async () => {
    await Promise.all(readers.map((reader) => reader.cancel()));
    database.close();
  });

  const metadata = await app.request(lessonPath);
  assert.equal(metadata.status, 200);
  const { keypoints, ...other } = await metadata.json();
  assert.equal(keypoints.length, 3);
  assert.deepEqual(other, {});
  const locked = await app.request(`${lessonPath.replace('u1-l1', 'u1-l2')}/sessions`, {
    method: 'POST',
  });
  assert.equal(locked.status, 409);
  const invalidStart = await app.request(`${lessonPath}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ generation: 1 }),
  });
  assert.equal(invalidStart.status, 400);
  const created = await app.request(`${lessonPath}/sessions`, { method: 'POST' });
  assert.equal(created.status, 201);
  const { session_id: id } = await created.json();
  const path = `/api/sessions/${id}`;
  const getCursor = () =>
    database.db.prepare('SELECT last_played_step_id, state FROM sessions WHERE id = ?').get(id);
  const post = (endpoint: string, body: object) =>
    app.request(`${path}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const progress = (generation: number, last_played_step_id: number) =>
    post('progress', { generation, last_played_step_id });

  async function openStream() {
    const response = await app.request(`${path}/stream`);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.ok(response.body);
    const reader = response.body.getReader();
    readers.push(reader);
    const next = async () => {
      const { done, value } = await reader.read();
      if (done) return undefined;
      const frame = new TextDecoder().decode(value);
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const payload = /^data: (.+)$/m.exec(frame)?.[1];
      assert.ok(event && payload, frame);
      const data: unknown = JSON.parse(payload);
      return { event, data };
    };
    const start = await next();
    assert.equal(start?.event, 'stream');
    const generation = readLessonGeneration(start?.data);
    assert.ok(generation);
    return { next, generation };
  }

  const first = await openStream();
  assert.equal(first.generation, 1);
  assert.equal(readLessonBeat((await first.next())?.data)?.action.step_id, 1);
  assert.equal(getCursor()?.last_played_step_id, null);
  const invalid = await post('progress', { generation: 1, last_played_step_id: '1' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).field, '/last_played_step_id');
  assert.equal((await progress(1, 2)).status, 409);
  assert.equal((await progress(1, 1)).status, 200);

  const unsaved = readLessonBeat((await first.next())?.data);
  assert.equal(unsaved?.seq, 2);
  assert.equal(getCursor()?.last_played_step_id, 1);
  const resumed = await openStream();
  assert.equal(resumed.generation, 2);
  assert.deepEqual(await first.next(), { event: 'superseded', data: { generation: 1 } });
  assert.equal(await first.next(), undefined);
  let beat = readLessonBeat((await resumed.next())?.data);
  assert.deepEqual(beat, { generation: 2, seq: 3, action: unsaved?.action });
  assert.equal((await progress(1, 2)).status, 409);

  while (beat && beat.action.type !== 'ask') {
    assert.equal((await progress(2, beat.action.step_id)).status, 200);
    beat = readLessonBeat((await resumed.next())?.data);
  }
  assert.equal(beat?.action.type, 'ask');
  const askStep = beat.action.step_id;
  const answer = { generation: 2, ask_step_id: askStep, text: '8 是分子，8+18 是报警人数分母。' };
  assert.equal((await post('answer', answer)).status, 409);
  assert.equal((await progress(2, askStep)).status, 200);
  assert.equal((await progress(2, askStep)).status, 200);
  assert.equal((await post('answer', { ...answer, text: '  ' })).status, 400);
  const afterAsk = resumed.next();
  assert.equal(await Promise.race([afterAsk.then(() => 'sent'), delay(250, 'waiting')]), 'waiting');
  assert.equal((await post('answer', answer)).status, 200);
  assert.equal((await post('answer', answer)).status, 200);

  const completionBeat = readLessonBeat((await afterAsk)?.data);
  assert.equal(completionBeat?.action.type, 'keypoint_complete');
  const afterAnswer = await openStream();
  assert.equal(afterAnswer.generation, 3);
  assert.deepEqual(await resumed.next(), { event: 'superseded', data: { generation: 2 } });
  assert.equal((await post('answer', { ...answer, generation: 3 })).status, 200);
  let frame = await afterAnswer.next();
  assert.deepEqual(readLessonBeat(frame?.data), {
    generation: 3,
    seq: completionBeat.seq + 1,
    action: completionBeat.action,
  });
  while (frame?.event === 'beat') {
    const action = readLessonBeat(frame.data)?.action;
    assert.ok(action);
    assert.equal((await progress(3, action.step_id)).status, 200);
    if (action.type === 'ask') {
      const pending = afterAnswer.next();
      assert.equal(
        await Promise.race([pending.then(() => 'sent'), delay(40, 'waiting')]),
        'waiting',
      );
      assert.equal(
        (
          await post('answer', {
            generation: 3,
            ask_step_id: action.step_id,
            text: '按题目给出的样本，分母是所有报警的包裹。',
          })
        ).status,
        200,
      );
      frame = await pending;
    } else {
      frame = await afterAnswer.next();
    }
  }
  assert.deepEqual(frame, { event: 'done', data: { generation: 3 } });
  assert.equal(getCursor()?.state, 'completed');
  const storedAnswers = database.db
    .prepare("SELECT payload_json FROM session_events WHERE session_id = ? AND kind = 'answer'")
    .all(id);
  assert.equal(storedAnswers.length, 3);
  assert.ok(storedAnswers.some(({ payload_json }) => payload_json === JSON.stringify(answer)));
  const replaced = database.db
    .prepare(
      "SELECT payload_json FROM session_events WHERE session_id = ? AND kind = 'superseded' ORDER BY id",
    )
    .all(id);
  assert.deepEqual(
    replaced.map(({ payload_json }) => payload_json),
    ['{"generation":1}', '{"generation":2}'],
  );
});
