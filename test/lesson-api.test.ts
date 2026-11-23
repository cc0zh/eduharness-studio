import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { BAYES_DEMO_ID, readLessonBeat, type SessionSnapshot } from '@eduharness-studio/engine';
import { createServerApp } from '../apps/server/src/app.js';
import { openStudioDatabase } from '../apps/server/src/db.js';

const lesson = `/api/courses/${BAYES_DEMO_ID}/lessons/u1-l1`;
const sessions = `${lesson}/sessions`;

function assertStreamEnd(
  frame: { event: string; data: unknown } | undefined,
  event: 'interrupted' | 'superseded',
  generation: number,
  lastPlayed: number,
) {
  assert.equal(frame?.event, event);
  const payload = frame?.data as { generation: number; snapshot?: SessionSnapshot };
  assert.equal(payload.generation, generation);
  assert.equal(payload.snapshot?.last_played_step_id, lastPlayed);
}

async function classroom(t: TestContext) {
  const database = openStudioDatabase(':memory:');
  const app = createServerApp({ database });
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  t.after(async () => {
    await Promise.all(readers.map((reader) => reader.cancel()));
    database.close();
  });
  const post = (path: string, body: object) =>
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const created = await post(sessions, {});
  assert.equal(created.status, 201);
  const { session_id: id } = (await created.json()) as SessionSnapshot;
  const endpoint = `/api/sessions/${id}`;
  async function open(generation: number) {
    const response = await app.request(`${endpoint}/stream?generation=${generation}`);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.ok(response.body);
    const reader = response.body.getReader();
    readers.push(reader);
    async function next() {
      const { done, value } = await reader.read();
      if (done) return undefined;
      const frame = new TextDecoder().decode(value);
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const payload = /^data: (.+)$/m.exec(frame)?.[1];
      assert.ok(event && payload, frame);
      return { event, data: JSON.parse(payload) as unknown };
    }
    assert.deepEqual(await next(), { event: 'stream', data: { generation } });
    return { next, cancel: () => reader.cancel() };
  }
  return {
    app,
    database,
    id,
    open,
    post,
    write: (action: string, body: object) => post(`${endpoint}/${action}`, body),
    ack: (generation: number, last_played_step_id: number) =>
      post(`${endpoint}/progress`, { generation, last_played_step_id }),
    async claim(receipt?: { generation: number; last_played_step_id: number }) {
      const response = await post(`${endpoint}/resume`, receipt ?? {});
      assert.equal(response.status, 200);
      return (await response.json()) as SessionSnapshot;
    },
    async snapshot() {
      const response = await app.request(`${sessions}/active`);
      assert.equal(response.status, 200);
      return (await response.json()) as SessionSnapshot;
    },
  };
}

test('lookup has no side effect; resume reissues only the outstanding beat and preserves a pending ask', {
  timeout: 12_000,
}, async (t) => {
  const c = await classroom(t);
  const metadata = await c.app.request(lesson);
  assert.equal(metadata.status, 200);
  const { keypoints, ...other } = await metadata.json();
  assert.equal(keypoints.length, 3);
  assert.deepEqual(other, {});
  assert.equal((await c.post(sessions.replace('u1-l1', 'u1-l2'), {})).status, 409);
  assert.equal((await c.post(sessions, { generation: 1 })).status, 400);

  const old = await c.open(1);
  assert.equal(readLessonBeat((await old.next())?.data)?.action.step_id, 1);
  assert.equal((await c.snapshot()).last_played_step_id, 0);
  assert.equal((await c.ack(1, 2)).status, 409);
  assert.equal((await c.ack(1, 1)).status, 200);
  const unsaved = readLessonBeat((await old.next())?.data);
  assert.equal(unsaved?.seq, 2);
  assert.deepEqual(
    (await c.snapshot()).playedActions.map((a) => a.step_id),
    [1],
  );

  const reattached = await c.open(1);
  assert.deepEqual(readLessonBeat((await reattached.next())?.data), unsaved);
  await reattached.cancel();
  const claimed = await c.claim();
  assert.equal(claimed.session_id, c.id);
  assert.equal(claimed.generation, 2);
  assertStreamEnd(await old.next(), 'superseded', 1, 1);
  assert.equal(await old.next(), undefined);
  const resumed = await c.open(2);
  let beat = readLessonBeat((await resumed.next())?.data);
  assert.deepEqual(beat, { generation: 2, seq: 3, action: unsaved?.action });
  const staleReplay = await c.ack(1, 2);
  assert.equal(staleReplay.status, 200);
  assert.deepEqual(await staleReplay.json(), { error: 'stale_generation' });
  while (beat && beat.action.type !== 'ask') {
    assert.equal((await c.ack(2, beat.action.step_id)).status, 200);
    beat = readLessonBeat((await resumed.next())?.data);
  }
  assert.equal(beat?.action.type, 'ask');
  const askStep = beat.action.step_id;
  const answer = { generation: 2, ask_step_id: askStep, text: '8 是分子，8+18 是分母。' };
  assert.equal((await c.write('answer', answer)).status, 409);
  assert.equal((await c.ack(2, askStep)).status, 200);
  assert.equal((await c.ack(2, askStep)).status, 200);
  assert.equal((await c.write('answer', { ...answer, text: '  ' })).status, 400);
  const pending = await c.snapshot();
  assert.equal(pending.askStep, askStep);
  assert.equal(pending.state, 'handoff');
  assert.deepEqual(await c.claim({ generation: 2, last_played_step_id: 1 }), {
    ...pending,
    generation: 3,
  });
  assertStreamEnd(await resumed.next(), 'superseded', 2, askStep);
  const afterResume = await c.open(3);
  const afterAsk = afterResume.next();
  assert.equal(await Promise.race([afterAsk.then(() => 'sent'), delay(180, 'waiting')]), 'waiting');
  assert.equal((await c.write('answer', { ...answer, generation: 3 })).status, 200);
  assert.equal((await c.write('answer', { ...answer, generation: 3 })).status, 200);
  const verify = readLessonBeat((await afterAsk)?.data);
  assert.ok(verify?.action.type === 'speak' && verify.action.checkpoint === 'verify');
  assert.equal((await c.snapshot()).state, 'handoff');
  assert.equal((await c.ack(3, verify.action.step_id)).status, 200);
  const completion = readLessonBeat((await afterResume.next())?.data);
  assert.equal(completion?.action.type, 'keypoint_complete');
  assert.equal((await c.snapshot()).state, 'verify');
  assert.equal((await c.snapshot()).records.filter(({ kind }) => kind === 'answer').length, 1);
});

test('resume atomically reconciles the beat already committed to the display', {
  timeout: 12_000,
}, async (t) => {
  const c = await classroom(t);
  const old = await c.open(1);
  const board = readLessonBeat((await old.next())?.data);
  assert.equal(board?.action.step_id, 1);
  assert.equal((await c.ack(1, 1)).status, 200);
  const shown = readLessonBeat((await old.next())?.data);
  assert.equal(shown?.action.type, 'speak');
  assert.equal((await c.snapshot()).last_played_step_id, 1);

  const restored = await c.claim({ generation: 1, last_played_step_id: 2 });
  assert.equal(restored.generation, 2);
  assert.equal(restored.last_played_step_id, 2);
  assert.deepEqual(
    restored.playedActions.map(({ step_id }) => step_id),
    [1, 2],
  );
  assert.ok(restored.records.some((record) => record.kind === 'subtitle' && record.step_id === 2));
  assertStreamEnd(await old.next(), 'superseded', 1, 2);
  const next = await c.open(2);
  const continuation = readLessonBeat((await next.next())?.data);
  assert.equal(continuation?.action.step_id, 3);
  assert.equal((await c.snapshot()).records.filter(({ kind }) => kind === 'subtitle').length, 1);
});

test('SQLite serializes two independent connections claiming while the old stream polls', {
  timeout: 12_000,
}, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'edu-m1-3-'));
  const databasePath = join(directory, 'studio.sqlite');
  const firstDb = openStudioDatabase(databasePath);
  const secondDb = openStudioDatabase(databasePath);
  const firstApp = createServerApp({ database: firstDb });
  const secondApp = createServerApp({ database: secondDb });
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  t.after(async () => {
    await Promise.all(readers.map((reader) => reader.cancel()));
    firstDb.close();
    secondDb.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const created = await firstApp.request(sessions, { method: 'POST' });
  assert.equal(created.status, 201);
  const { session_id: id } = (await created.json()) as SessionSnapshot;
  const path = `/api/sessions/${id}`;
  const oldResponse = await firstApp.request(`${path}/stream?generation=1`);
  assert.ok(oldResponse.body);
  const oldReader = oldResponse.body.getReader();
  readers.push(oldReader);
  const readFrame = async () => {
    const { done, value } = await oldReader.read();
    if (done) return undefined;
    const frame = new TextDecoder().decode(value);
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    assert.ok(event && data);
    return { event, data: JSON.parse(data) as unknown };
  };
  await readFrame();
  assert.equal(readLessonBeat((await readFrame())?.data)?.action.step_id, 1);
  const claimed = await secondApp.request(`${path}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(claimed.status, 200);
  const snapshot = (await claimed.json()) as SessionSnapshot;
  assert.equal(snapshot.generation, 2);
  assert.equal(snapshot.last_played_step_id, 0);
  assertStreamEnd(await readFrame(), 'superseded', 1, 0);
  const newResponse = await secondApp.request(`${path}/stream?generation=2`);
  assert.ok(newResponse.body);
  const newReader = newResponse.body.getReader();
  readers.push(newReader);
  await newReader.read();
  const frame = await newReader.read();
  const beat = readLessonBeat(
    JSON.parse(new TextDecoder().decode(frame.value).match(/^data: (.+)$/m)?.[1] ?? 'null'),
  );
  assert.equal(beat?.generation, 2);
  assert.equal(beat?.action.step_id, 1);
  const stale = await firstApp.request(`${path}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ generation: 1, last_played_step_id: 1 }),
  });
  assert.equal(stale.status, 200);
  assert.deepEqual(await stale.json(), { error: 'stale_generation' });
});

test('all keypoints verify before completion and completed sessions survive another claim', {
  timeout: 12_000,
}, async (t) => {
  const c = await classroom(t);
  const stream = await c.open(1);
  const completed = [];
  while (true) {
    const frame = await stream.next();
    if (frame?.event === 'done') break;
    const beat = readLessonBeat(frame?.data);
    assert.equal(frame?.event, 'beat');
    assert.ok(beat);
    assert.equal((await c.ack(1, beat.action.step_id)).status, 200);
    if (beat.action.type === 'keypoint_complete') completed.push(beat.action.keypoint_id);
    if (beat.action.type === 'ask') {
      assert.equal(
        (
          await c.write('answer', {
            generation: 1,
            ask_step_id: beat.action.step_id,
            text: '我会先划出题目给定的范围，再数里面符合条件的样本。',
          })
        ).status,
        200,
      );
    }
  }
  assert.equal(completed.length, 3);
  assert.equal((await c.snapshot()).state, 'completed');
  const rows = c.database.db
    .prepare('SELECT id,kind,payload_json FROM session_events WHERE session_id = ? ORDER BY id')
    .all(c.id)
    .map(({ id, kind, payload_json }) => ({
      id,
      kind,
      data: JSON.parse(payload_json),
    }));
  for (const beat of rows.filter(
    ({ kind, data }) => kind === 'beat' && data.action.type === 'keypoint_complete',
  )) {
    assert.equal(
      rows.filter(({ kind, id }) => kind === 'state' && id < beat.id).at(-1)?.data.to,
      'verify',
    );
  }
  const claimed = await c.claim();
  assert.equal(claimed.session_id, c.id);
  assert.equal(claimed.state, 'completed');
  assert.deepEqual(claimed.playedActions, (await c.snapshot()).playedActions);
  const doneStream = await c.open(claimed.generation);
  const done = await doneStream.next();
  assert.equal(done?.event, 'done');
  const data = done?.data as { generation: number; snapshot: SessionSnapshot };
  assert.equal(data.generation, claimed.generation);
  assert.equal(data.snapshot.state, 'completed');
});

test('interrupt rotates instead of superseding; rejects a skipped frame and can reconcile the one displayed frame', {
  timeout: 12_000,
}, async (t) => {
  const c = await classroom(t);
  const first = await c.open(1);
  const board = readLessonBeat((await first.next())?.data);
  assert.equal(board?.action.step_id, 1);
  const input = { generation: 1, last_played_step_id: 1, text: '直接告诉我答案' };
  assert.equal((await c.write('interrupt', { ...input, last_played_step_id: 2 })).status, 409);
  assert.equal((await c.snapshot()).last_played_step_id, 0);
  const response = await c.write('interrupt', input);
  assert.equal(response.status, 200);
  const rotated = (await response.json()) as SessionSnapshot;
  assert.equal(rotated.generation, 2);
  assert.deepEqual(rotated.playedActions, [board?.action]);
  const cutoff = rotated.records.at(-1);
  assert.ok(cutoff?.kind === 'interrupt');
  assert.equal(cutoff.last_played_step_id, 1);
  assert.equal(cutoff.truncated_step_ids[0], 2);
  assert.equal(cutoff.intent, 'answer-request');
  assertStreamEnd(await first.next(), 'interrupted', 1, 1);
  assert.equal(await first.next(), undefined);
  const staleInterruptAck = await c.ack(1, 1);
  assert.equal(staleInterruptAck.status, 200);
  assert.deepEqual(await staleInterruptAck.json(), { error: 'stale_generation' });
  const continued = await c.open(2);
  const scaffold = readLessonBeat((await continued.next())?.data);
  assert.ok(scaffold?.action.type === 'speak');
  assert.match(scaffold.action.text, /先不揭底/);
  assert.ok(scaffold.action.step_id > Math.max(...cutoff.truncated_step_ids));
  assert.equal((await c.snapshot()).last_played_step_id, 1);

  const takeover = await c.claim();
  assert.equal(takeover.generation, 3);
  const obsolete = await c.open(1);
  assert.deepEqual(await obsolete.next(), {
    event: 'superseded',
    data: { generation: 1, snapshot: takeover },
  });
  assertStreamEnd(await continued.next(), 'superseded', 2, 1);
  const current = await c.open(3);
  const restarted = await c.post(sessions, { restart: true });
  assert.equal(restarted.status, 201);
  const clean = (await restarted.json()) as SessionSnapshot;
  assert.notEqual(clean.session_id, c.id);
  assert.deepEqual(clean.playedActions, []);
  assert.deepEqual(clean.records, []);
  assert.equal(clean.askStep, null);
  const outstanding = await current.next();
  assert.equal(outstanding?.event, 'beat');
  assertStreamEnd(await current.next(), 'superseded', 3, 1);
  assert.deepEqual(await c.snapshot(), clean);
  assert.equal((await c.write('resume', {})).status, 404);
});
