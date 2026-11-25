import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action } from '@eduharness-studio/engine';
import { afterSkip, makeFixture, opening, scaffold, startAtAsk } from './teacher-test-support.js';

test('a truncated skip stays pending until its replacement outcome is acknowledged', async (t) => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fixture.structured(opening)]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  fixture.faux.setResponses([fixture.structured(scaffold)]);
  const first = await fixture.store.answer(live.id, {
    generation: live.generation,
    ask_step_id: live.ask.step_id,
    text: '1',
  });
  assert.ok('keypoints' in first);
  const stream = fixture.store.openStream(live.id, live.generation);
  assert.ok(stream && !('error' in stream));
  let choice: Extract<Action, { type: 'ask' }> | undefined;
  for (let step = 0; step < 8 && !choice; step += 1) {
    const beat = fixture.store.poll(stream);
    assert.equal(beat.kind, 'beat');
    if (beat.kind !== 'beat') throw new Error('Expected the first low-effort choice beat');
    assert.ok(
      'ok' in
        fixture.store.progress(live.id, {
          generation: live.generation,
          last_played_step_id: beat.beat.action.step_id,
        }),
    );
    if (beat.beat.action.type === 'ask' && beat.beat.action.mode === 'choice')
      choice = beat.beat.action;
  }
  assert.ok(choice);
  const activeKeypointId = fixture.store
    .inspect(live.id)
    ?.snapshot.keypoints?.find(({ status }) => status === 'active')?.id;
  assert.ok(activeKeypointId);
  fixture.faux.setResponses([fixture.structured(afterSkip)]);
  const second = await fixture.store.answer(live.id, {
    generation: live.generation,
    ask_step_id: choice.step_id,
    text: '继续',
  });
  assert.ok(
    'keypoints' in second,
    `${JSON.stringify(second)} ${JSON.stringify(fixture.store.inspect(live.id)?.trace)}`,
  );
  assert.equal(fixture.store.inspect(live.id)?.snapshot.keypoints?.[0].status, 'active');
  const queued = fixture.store.openStream(live.id, live.generation);
  assert.ok(queued && !('error' in queued));
  // Receive the planned mark but interrupt before acknowledging it: issued is not played.
  let playedBeforeTruncation = choice.step_id;
  let issuedMark: number | undefined;
  for (let step = 0; step < 12; step += 1) {
    const beat = fixture.store.poll(queued);
    assert.equal(beat.kind, 'beat');
    if (beat.kind !== 'beat') throw new Error('Expected the queued unverified mark');
    if (beat.beat.action.type === 'keypoint_unverified') {
      issuedMark = beat.beat.action.step_id;
      break;
    }
    playedBeforeTruncation = beat.beat.action.step_id;
    assert.ok(
      'ok' in
        fixture.store.progress(live.id, {
          generation: live.generation,
          last_played_step_id: playedBeforeTruncation,
        }),
    );
  }
  assert.ok(issuedMark);
  const beforeInterrupt = fixture.store.inspect(live.id);
  const pendingAnswerSkip = beforeInterrupt?.trace.teacherTurns?.find(
    ({ trigger, unverified }) => trigger === 'answer' && unverified === activeKeypointId,
  );
  assert.ok(pendingAnswerSkip?.unverifiedStepId);
  assert.equal(issuedMark, pendingAnswerSkip.unverifiedStepId);
  assert.equal(
    beforeInterrupt?.trace.playedStepIds?.includes(pendingAnswerSkip.unverifiedStepId),
    false,
  );
  assert.equal(beforeInterrupt?.snapshot.keypoints?.[0].status, 'active');

  fixture.faux.setResponses([fixture.structured(afterSkip)]);
  const resumed = await fixture.store.interrupt(live.id, {
    generation: live.generation,
    last_played_step_id: playedBeforeTruncation,
    text: '继续',
  });
  assert.ok(!('error' in resumed));
  assert.equal(resumed.keypoints?.[0].status, 'active');
  const afterInterrupt = fixture.store.inspect(live.id);
  const pendingInterruptSkip = afterInterrupt?.trace.teacherTurns?.find(
    ({ trigger, unverified }) => trigger === 'interrupt' && unverified === activeKeypointId,
  );
  assert.ok(pendingInterruptSkip?.unverifiedStepId);
  assert.ok(pendingInterruptSkip.unverifiedStepId > issuedMark);
  assert.equal(
    afterInterrupt?.trace.playedStepIds?.includes(pendingInterruptSkip.unverifiedStepId),
    false,
  );

  const resumedStream = fixture.store.openStream(live.id, resumed.generation);
  assert.ok(resumedStream && !('error' in resumedStream));
  let acknowledgedStep = 0;
  for (let step = 0; step < 8; step += 1) {
    const beat = fixture.store.poll(resumedStream);
    assert.equal(beat.kind, 'beat');
    if (beat.kind !== 'beat') throw new Error('Expected the retried unverified beat');
    acknowledgedStep = beat.beat.action.step_id;
    assert.ok(
      'ok' in
        fixture.store.progress(live.id, {
          generation: resumed.generation,
          last_played_step_id: acknowledgedStep,
        }),
    );
    if (beat.beat.action.type === 'keypoint_unverified') break;
  }
  assert.equal(acknowledgedStep, pendingInterruptSkip.unverifiedStepId);
  assert.equal(
    fixture.store.inspect(live.id)?.trace.playedStepIds?.includes(acknowledgedStep),
    true,
  );
  assert.equal(fixture.store.inspect(live.id)?.snapshot.keypoints?.[0].status, 'unverified');
});
