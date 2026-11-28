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

for (const playedCount of [61, 64]) {
  test(`offline live lesson at ${playedCount} acknowledged beats closes and resumes inside 70`, async (t) => {
    const fixture = makeFixture(t);
    const offline = createFauxModelGateway();
    const store = createSessionStore(
      sessionDatabase(fixture.database.db),
      createTeacherPlanner(offline.gateway),
    );
    const actions: Action[] = Array.from({ length: playedCount - 1 }, (_, i) => ({
      type: 'speak',
      step_id: (i + 1) * 10,
      text: '已讲过的例子。',
    }));
    const ask = {
      type: 'ask',
      mode: 'open',
      step_id: playedCount * 10,
      card_id: 'q',
      prompt: '怎么配对？',
    } as const;
    actions.push(ask);
    const draft = lessonDraft();
    const started = await store.start({
      ...fixture.options(false),
      prepare: () => ({
        script: {
          keypoints: draft.keypoints.map((point, i) => ({
            ...point,
            status: i === 0 ? 'active' : 'pending',
          })),
          actions,
        },
        openingEvidence: {
          diagnosis: { status: 'opening', summary: '观察配对', strategy: '举例' },
          durationMs: 0,
          guardrails: [],
        },
      }),
    });
    assert.ok('snapshot' in started);
    const { session_id: id, generation } = started.snapshot;
    const stream = store.openStream(id, generation);
    assert.ok(stream && !('error' in stream));
    for (const action of actions) {
      const next = store.poll(stream);
      assert.equal(next.kind, 'beat');
      assert.deepEqual(next.beat.action, action);
      assert.ok('ok' in store.progress(id, { generation, last_played_step_id: action.step_id }));
    }
    let askStep = ask.step_id;
    if (playedCount === 61) {
      const low = await store.answer(id, { generation, ask_step_id: askStep, text: '１' });
      assert.ok('ok' in low, JSON.stringify(low));
      for (const kind of ['speak', 'board', 'ask']) {
        const next = store.poll(stream);
        assert.equal(next.kind, 'beat');
        assert.equal(next.beat.action.type, kind);
        askStep = next.beat.action.step_id;
        assert.ok('ok' in store.progress(id, { generation, last_played_step_id: askStep }));
      }
    }
    const handoff = await store.answer(id, { generation, ask_step_id: askStep, text: '１' });
    assert.ok('ok' in handoff, JSON.stringify(handoff));
    const cue = store.poll(stream);
    assert.equal(cue.kind, 'beat');
    assert.ok(cue.beat.action.type === 'speak' && cue.beat.action.text.includes('未验证'));
    assert.ok(
      'ok' in store.progress(id, { generation, last_played_step_id: cue.beat.action.step_id }),
    );
    const issued = store.poll(stream);
    assert.equal(issued.kind, 'beat');
    assert.equal(issued.beat.action.type, 'keypoint_unverified');

    // The issued mark is retired, not counted or applied. The acknowledged cue is still usable.
    const resumed = await store.interrupt(id, {
      generation,
      last_played_step_id: cue.beat.action.step_id,
      text: ' 还有一个问题。 ',
    });
    assert.ok(!('error' in resumed), JSON.stringify(resumed));
    assert.equal(resumed.state, 'scaffold');
    assert.deepEqual(
      resumed.keypoints?.map(({ status }) => status),
      ['active', 'pending'],
    );
    const continuation = store.openStream(id, resumed.generation);
    assert.ok(continuation && !('error' in continuation));
    const types: Action['type'][] = [];
    for (let i = 0; i < 5; i++) {
      const next = store.poll(continuation);
      assert.equal(next.kind, 'beat');
      assert.ok(next.beat.action.step_id > issued.beat.action.step_id);
      types.push(next.beat.action.type);
      assert.ok(
        'ok' in
          store.progress(id, {
            generation: resumed.generation,
            last_played_step_id: next.beat.action.step_id,
          }),
      );
    }
    assert.deepEqual(types, [
      'keypoint_unverified',
      'speak',
      'keypoint_unverified',
      'new_page',
      'board',
    ]);
    const final = store.inspect(id);
    assert.equal(final?.snapshot.state, 'completed');
    assert.equal(final.snapshot.playedActions.length, 70);
    assert.deepEqual(
      final.snapshot.keypoints?.map(({ status }) => status),
      ['unverified', 'unverified'],
    );
    assert.equal(final.trace.playedStepIds?.includes(issued.beat.action.step_id), false);
    assert.equal(offline.state.callCount, 0);
  });
}
