import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action } from '@eduharness-studio/engine';
import { createFauxModelGateway } from '@eduharness-studio/engine/models';
import { createTeacherPlanner } from '@eduharness-studio/engine/teacher';
import { sessionDatabase } from '../apps/server/src/session-db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';
import { lessonDraft, makeFixture, startAtAsk } from './teacher-test-support.js';

test('an offline gateway marks the answered point unverified and continues deterministically', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(lessonDraft())]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  const offlineGateway = createFauxModelGateway();
  const offlineStore = createSessionStore(
    sessionDatabase(fixture.database.db),
    createTeacherPlanner(offlineGateway.gateway),
  );
  const receipt = await offlineStore.answer(live.id, {
    generation: live.generation,
    ask_step_id: live.ask.step_id,
    text: 'I will try the next example.',
  });
  assert.ok('ok' in receipt && 'keypoints' in receipt);
  const stream = offlineStore.openStream(live.id, live.generation);
  assert.ok(stream && !('error' in stream));
  const visible: string[] = [];
  let skipped = false;
  let askStep = 0;
  for (let step = 0; step < 8; step += 1) {
    const next = offlineStore.poll(stream);
    if (next.kind !== 'beat') break;
    visible.push(next.beat.action.type);
    assert.ok(
      'ok' in
        offlineStore.progress(live.id, {
          generation: live.generation,
          last_played_step_id: next.beat.action.step_id,
        }),
    );
    if (next.beat.action.type === 'keypoint_unverified') skipped = true;
    if (skipped && next.beat.action.type === 'ask') {
      askStep = next.beat.action.step_id;
      break;
    }
  }
  assert.ok(visible.includes('keypoint_unverified'));
  assert.equal(visible.includes('keypoint_complete'), false);
  const active = offlineStore.active(fixture.course.id, fixture.lesson.id);
  assert.ok(active && !('error' in active));
  assert.equal(active.keypoints?.[0].status, 'unverified');
  assert.ok(
    offlineStore
      .inspect(live.id)
      ?.trace.spans.some(({ name }) => name === 'teacher_model_unavailable_fallback'),
  );
  const resumed = await offlineStore.interrupt(live.id, {
    generation: live.generation,
    last_played_step_id: askStep,
    text: '换个例子说明。',
  });
  assert.ok(!('error' in resumed));
  assert.equal(resumed.generation, live.generation + 1);
  assert.equal(resumed.last_played_step_id, askStep);
  const continuation = offlineStore.openStream(live.id, resumed.generation);
  assert.ok(continuation && !('error' in continuation));
  const first = offlineStore.poll(continuation);
  assert.equal(first.kind, 'beat');
  if (first.kind !== 'beat')
    throw new Error('Expected deterministic offline interruption recovery');
  assert.equal(first.beat.action.type, 'speak');
  assert.ok(
    offlineStore
      .inspect(live.id)
      ?.trace.spans.filter(({ name }) => name === 'teacher_model_unavailable_fallback').length >= 2,
  );
});

test('offline first low effort gets a two-choice scaffold; repeated low effort advances unverified', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(lessonDraft())]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  const offlineGateway = createFauxModelGateway();
  const offlineStore = createSessionStore(
    sessionDatabase(fixture.database.db),
    createTeacherPlanner(offlineGateway.gateway),
  );
  const first = await offlineStore.answer(live.id, {
    generation: live.generation,
    ask_step_id: live.ask.step_id,
    text: '１',
  });
  assert.ok('keypoints' in first);
  const stream = offlineStore.openStream(live.id, live.generation);
  assert.ok(stream && !('error' in stream));
  let choice: Extract<Action, { type: 'ask'; mode: 'choice' }> | undefined;
  for (let step = 0; step < 8 && !choice; step += 1) {
    const next = offlineStore.poll(stream);
    assert.equal(next.kind, 'beat');
    if (next.kind !== 'beat') throw new Error('Expected offline low-effort scaffold');
    assert.ok(
      'ok' in
        offlineStore.progress(live.id, {
          generation: live.generation,
          last_played_step_id: next.beat.action.step_id,
        }),
    );
    if (next.beat.action.type === 'ask' && next.beat.action.mode === 'choice')
      choice = next.beat.action;
  }
  assert.ok(choice);
  assert.equal(choice.options?.length, 2);
  const afterFirst = offlineStore.inspect(live.id);
  assert.equal(afterFirst?.snapshot.keypoints?.[0].status, 'active');
  assert.equal(
    afterFirst?.trace.teacherTurns?.some(({ unverified }) => unverified),
    false,
  );

  const second = await offlineStore.answer(live.id, {
    generation: live.generation,
    ask_step_id: choice.step_id,
    text: '继续',
  });
  assert.ok('keypoints' in second);
  let unverifiedStep = 0;
  for (let step = 0; step < 8; step += 1) {
    const next = offlineStore.poll(stream);
    assert.equal(next.kind, 'beat');
    if (next.kind !== 'beat') throw new Error('Expected repeated offline low-effort fallback');
    unverifiedStep = next.beat.action.step_id;
    assert.ok(
      'ok' in
        offlineStore.progress(live.id, {
          generation: live.generation,
          last_played_step_id: unverifiedStep,
        }),
    );
    if (next.beat.action.type === 'keypoint_unverified') break;
  }
  const afterSkip = offlineStore.inspect(live.id);
  assert.equal(afterSkip?.snapshot.keypoints?.[0].status, 'unverified');
  assert.equal(afterSkip?.trace.playedStepIds?.includes(unverifiedStep), true);
});
