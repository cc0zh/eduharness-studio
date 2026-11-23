import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Action,
  buildInterruptQueue,
  canTransition,
  classifyInterrupt,
  demoCourses,
  generateBlueprint,
  offlineLesson,
  stateAfterBeat,
  type TeachingState,
  validateLessonScript,
} from '../src/index.js';

const learnerInputs = ['为什么要这样算？我没听懂', '直接告诉我答案', '好的，继续'] as const;

test('offline intent precedence respects requests not to spoil the answer', () => {
  assert.deepEqual(learnerInputs.map(classifyInterrupt), ['explain', 'answer-request', 'continue']);
  assert.equal(classifyInterrupt('为什么？别直接告诉我答案，换个例子'), 'explain');
  assert.equal(classifyInterrupt('答案我有了，继续'), 'continue');
  assert.equal(classifyInterrupt('Just tell me the solution'), 'answer-request');
});

test('truncates exactly at the boundary and never reuses an issued ID or an unplayed card', () => {
  const generated = generateBlueprint('course-boundary', {
    topic: '线性代数',
    foundation: 'beginner',
    goal: 'apply',
  });
  for (const course of [...demoCourses, generated]) {
    const script = offlineLesson(course, course.units[0].lessons[0]);
    const firstPageTurn = script.actions.find((action) => action.type === 'new_page');
    const firstPageTurnStep = firstPageTurn?.step_id ?? 2;
    const contextCompleteStep = script.actions.find(
      (action) => action.type === 'keypoint_complete' && action.keypoint_id === 'context',
    )?.step_id;
    const cutPoints = [
      null,
      1,
      firstPageTurnStep,
      ...(contextCompleteStep ? [contextCompleteStep] : []),
    ];
    for (const step of cutPoints) {
      const openings = new Set<string>();
      for (const text of learnerInputs) {
        const cut = buildInterruptQueue(script, step, text, course.topic);
        assert.equal(cut.lastPlayedStepId, step);
        assert.deepEqual(
          cut.played,
          script.actions.filter(({ step_id }) => step_id <= (step ?? 0)),
        );
        assert.deepEqual(
          cut.truncated,
          script.actions.filter(({ step_id }) => step_id > (step ?? 0)),
        );
        assert.deepEqual(cut.actions.slice(0, cut.played.length), cut.played);
        const discarded = new Set(
          cut.truncated.flatMap((action) => ('card_id' in action ? [action.card_id] : [])),
        );
        const first = cut.batch[0];
        assert.equal(first.type, 'speak');
        openings.add(first.text);
        if (cut.intent === 'answer-request') {
          assert.match(first.text, /先不揭底/);
          const askIndex = cut.batch.findIndex((action) => action.type === 'ask');
          const verifyIndex = cut.batch.findIndex(
            (action) => action.type === 'speak' && action.checkpoint === 'verify',
          );
          assert.equal(cut.batch[askIndex]?.type, 'ask');
          assert.ok(verifyIndex > askIndex, 'the answer scaffold must stop at its ask');
        }
        if (course.id === 'demo-transformer' && (step === null || step === contextCompleteStep)) {
          const graphIndex = cut.batch.findIndex((action) => action.type === 'graph');
          const pointedTextIndex = cut.batch.findIndex(
            (action) => action.type === 'speak' && action.text.includes('Q、K、V 三条路径'),
          );
          assert.ok(graphIndex >= 0);
          assert.ok(pointedTextIndex > graphIndex);
          const earlierArrowTalk = cut.batch.findIndex(
            (action) =>
              action.step_id < cut.batch[graphIndex].step_id &&
              action.type === 'speak' &&
              /箭头|三路/.test(action.text),
          );
          assert.equal(earlierArrowTalk, -1);
          const graph = cut.batch[graphIndex];
          assert.ok(graph.type === 'graph');
          assert.notEqual(graph.card_id, 'qkv-flow');
        }
        if (course === generated) assert.match(first.text, /线性代数/);
        assert.ok(first.step_id > (script.actions.at(-1)?.step_id ?? 0));
        for (const [i, action] of cut.batch.entries()) {
          assert.equal(action.step_id, first.step_id + i);
          if ('card_id' in action) assert.ok(!discarded.has(action.card_id));
        }
        assert.ok(validateLessonScript({ ...script, actions: cut.actions }));
      }
      assert.equal(openings.size, 3);
    }
  }
});

test('rejects a forward or discarded highlight target and a reused step ID', () => {
  const course = demoCourses[0];
  const script = offlineLesson(course, course.units[0].lessons[0]);
  const action: Action = {
    type: 'highlight',
    step_id: 1,
    card_id: 'alarm-areas',
    target_text: 'x',
    style: 'circle',
  };
  assert.equal(
    validateLessonScript({ ...script, actions: [action, ...script.actions.slice(1)] }),
    false,
  );
  assert.equal(
    validateLessonScript({ ...script, actions: [script.actions[0], script.actions[0]] }),
    false,
  );
});

test('an acknowledged verification beat after an answer is required before each completion', () => {
  const course = demoCourses[0];
  const script = offlineLesson(course, course.units[0].lessons[0]);
  const completion = script.actions.find((action) => action.type === 'keypoint_complete');
  const verification = script.actions.find(
    (action) => action.type === 'speak' && action.checkpoint === 'verify',
  );
  assert.ok(completion && verification);
  for (const state of ['intake', 'diagnose', 'scaffold', 'handoff', 'completed'] as const) {
    assert.equal(stateAfterBeat(state, completion, false, true), undefined);
    assert.equal(stateAfterBeat(state, completion, false, false), undefined);
  }
  assert.equal(stateAfterBeat('scaffold', verification, false, false), undefined);
  assert.equal(stateAfterBeat('handoff', verification, true, false), undefined);
  assert.equal(stateAfterBeat('handoff', verification, false, false), 'verify');
  assert.equal(stateAfterBeat('verify', completion, false, true), 'completed');
  assert.equal(canTransition('verify', 'diagnose'), true);

  for (const candidate of demoCourses.map((demo) =>
    offlineLesson(demo, demo.units[0].lessons[0]),
  )) {
    for (const actions of [
      candidate.actions,
      buildInterruptQueue(candidate, null, learnerInputs[1], course.topic).batch,
    ]) {
      let state: TeachingState = 'diagnose';
      for (const [i, action] of actions.entries()) {
        const next = stateAfterBeat(state, action, false, i === actions.length - 1);
        assert.ok(next);
        assert.ok(canTransition(state, next));
        state = next;
      }
      assert.equal(state, 'completed');
    }
  }
});
