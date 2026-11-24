import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';
import { makeFixture, opening, scaffold, startAtAsk } from './teacher-test-support.js';

test('another SQLite connection cannot duplicate an in-flight teacher model turn', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(opening)]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  const secondDb = openStudioDatabase(fixture.path);
  const otherStore = createSessionStore(secondDb, fixture.planner);
  fixture.closeAdditional.push(() => secondDb.close());
  let began: (() => void) | undefined;
  let release: (() => void) | undefined;
  const planning = new Promise<void>((resolve) => {
    began = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  fixture.faux.setResponses([
    async () => {
      began?.();
      await held;
      return fixture.structured(scaffold);
    },
    fixture.structured(scaffold),
  ]);
  const answer = { generation: live.generation, ask_step_id: live.ask.step_id, text: '继续' };
  const first = fixture.store.answer(live.id, answer);
  await planning;
  const requests = fixture.faux.state.callCount;
  assert.deepEqual(await otherStore.answer(live.id, answer), { error: 'teacher_turn_busy' });
  assert.equal(fixture.faux.state.callCount, requests);
  assert.deepEqual(await otherStore.start(fixture.options(true)), { error: 'teacher_turn_busy' });
  assert.equal(fixture.faux.state.callCount, requests);
  release?.();
  assert.ok('ok' in (await first));
});

test('an in-flight cross-worker interruption keeps the previous SSE stream idle', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(opening)]);
  const started = await fixture.store.start(fixture.options(false));
  assert.ok('snapshot' in started);
  const { session_id: id, generation } = started.snapshot;
  const oldStream = fixture.store.openStream(id, generation);
  assert.ok(oldStream && !('error' in oldStream));
  const firstBeat = fixture.store.poll(oldStream);
  assert.equal(firstBeat.kind, 'beat');
  if (firstBeat.kind !== 'beat') throw new Error('Expected the first scaffold beat');
  assert.ok(
    'ok' in
      fixture.store.progress(id, {
        generation,
        last_played_step_id: firstBeat.beat.action.step_id,
      }),
  );

  const secondDb = openStudioDatabase(fixture.path);
  const otherStore = createSessionStore(secondDb, fixture.planner);
  const otherStream = otherStore.openStream(id, generation);
  assert.ok(otherStream && !('error' in otherStream));
  fixture.closeAdditional.push(() => secondDb.close());
  let began: (() => void) | undefined;
  let release: (() => void) | undefined;
  const planning = new Promise<void>((resolve) => {
    began = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  fixture.faux.setResponses([
    async () => {
      began?.();
      await held;
      return fixture.structured({
        diagnosis: { status: 'clarifying', summary: '换个例子。', strategy: '保持未完成。' },
        actions: [
          { type: 'board', column: 1, card_id: 'interrupt-board', content: '再看一组积木。' },
          { type: 'speak', text: '先把积木每两块放成一组。' },
          { type: 'highlight', card_id: 'interrupt-board', target_text: '两块', style: 'circle' },
          { type: 'ask', card_id: 'interrupt-ask', mode: 'open', prompt: '七块会剩下几块？' },
        ],
      });
    },
  ]);
  const continuation = fixture.store.interrupt(id, {
    generation,
    last_played_step_id: firstBeat.beat.action.step_id,
    text: '换个角度讲。',
  });
  await planning;
  assert.deepEqual(otherStore.poll(otherStream), { kind: 'waiting' });
  release?.();
  const resumed = await continuation;
  assert.ok(!('error' in resumed));
  assert.equal(resumed.generation, generation + 1);
  assert.deepEqual(otherStore.poll(otherStream), { kind: 'interrupted', snapshot: resumed });
});
