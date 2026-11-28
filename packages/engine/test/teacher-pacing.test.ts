import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { stateAfterScriptBeat, validateLessonScript } from '../src/lesson-playback.js';
import type { Action } from '../src/protocol.js';
import { truncateOnInterrupt } from '../src/state.js';
import {
  compileTeacherTurn,
  createTeacherPlanner,
  type TeacherTurnContext,
  teacherTurnPolicy,
} from '../src/teacher.js';
import { teacherSceneInstructions } from '../src/teacher-prompt.js';
import {
  answeredContext,
  fauxResult,
  localFaux,
  masteredScene,
  scene,
  verifiedContext,
} from './teacher-scene-fixture.js';

function atBeat(count: number, base = answeredContext): TeacherTurnContext {
  const played: Action[] = Array.from({ length: count - 2 }, (_, i) => ({
    type: 'speak',
    step_id: (i + 1) * 10,
    text: '已经讲过的例子。',
  }));
  played.push({
    type: 'board',
    step_id: (count - 1) * 10,
    card_id: 'right',
    column: 2,
    content: '比较',
  });
  const ask = base.played.at(-1);
  assert.ok(ask?.type === 'ask' && base.input.kind === 'answer');
  played.push({ ...ask, step_id: count * 10 });
  return {
    ...base,
    played,
    input: { ...base.input, ask_step_id: count * 10 },
    progress: { ...base.progress, highWater: (count + 14) * 10 },
  };
}

test('the phase mask counts acknowledged beats and only unresolved points, not sparse step IDs', () => {
  const two = atBeat(39);
  const three = {
    ...two,
    keypoints: [...two.keypoints, { ...two.keypoints[1], id: 'later' }],
  };
  const { schema: regular } = teacherTurnPolicy(two);
  const tightPolicy = teacherTurnPolicy(three);
  const { schema: tight } = tightPolicy;
  const example = scene('missing_prereq');
  const twoPanels = { ...example, panels: [...example.panels, ...example.panels] };
  const insertion = {
    ...example,
    insert_keypoint: {
      id: 'before',
      title: '分组',
      objective: '会把积木分组。',
      depth: 'intuition',
    },
  };
  assert.ok(Value.Check(regular, twoPanels));
  assert.ok(Value.Check(regular, insertion));
  assert.ok(Value.Check(tight, example));
  assert.equal(Value.Check(tight, twoPanels), false);
  assert.equal(Value.Check(tight, insertion), false);
  const rejected = compileTeacherTurn(three, insertion);
  assert.ok(!rejected.ok);
  assert.match(rejected.reasons.join(' '), /insert_keypoint: unexpected field/);

  const [first, ...rest] = three.played;
  const resolved = teacherTurnPolicy({
    ...three,
    played: [
      { type: 'keypoint_unverified', step_id: first.step_id, keypoint_id: 'pairs' },
      ...rest,
    ],
  });
  assert.equal(resolved.schema.properties.panels.maxItems, 2);
  assert.ok(Value.Check(resolved.schema, insertion));

  const prompt = teacherSceneInstructions(tightPolicy);
  assert.match(prompt, /硬顶 70 拍/);
  assert.match(prompt, /已上屏 39 拍，3 个要点尚无结果/);
  assert.match(prompt, /panels：1 项列表/);
  assert.doesNotMatch(prompt, /insert_keypoint/);
});

test('a schema-valid overlong scene receives the compiler budget reason on the next #3 attempt', async () => {
  const context = atBeat(61);
  const { gateway, setResponses, state } = localFaux();
  const rich = scene('clarifying');
  rich.panels[0].title = '不要回显这条分镜标题';
  assert.ok(Value.Check(teacherTurnPolicy(context).schema, rich));
  setResponses([
    fauxResult(rich),
    (request) => {
      const prompt = request.messages.find(({ role }) => role === 'user')?.content;
      assert.match(String(prompt), /beat budget exceeded: 3 beats available/);
      assert.doesNotMatch(String(prompt), /不要回显这条分镜标题/);
      return fauxResult({ ...rich, panels: [{ title: '比较', content: '换一个简单例子。' }] });
    },
  ]);
  const accepted = await createTeacherPlanner(gateway, [])(context, []);
  assert.ok(accepted.ok, JSON.stringify(accepted));
  assert.equal(state.callCount, 2);
  assert.equal(accepted.trace.guardrails.length, 1);
  assert.match(accepted.trace.guardrails[0].reasons[0], /beat budget exceeded/);
  assert.deepEqual(
    accepted.actions.map(({ type }) => type),
    ['new_page', 'board', 'ask'],
  );
  assert.equal(context.played.length + accepted.actions.length, 64);
});

test('the exact 70-beat close is honest, does not call a model, and survives every possible cut', async () => {
  const context = atBeat(64, verifiedContext);
  assert.equal(teacherTurnPolicy(context).phase, 'budget-close');
  const { gateway, state } = localFaux();
  const closed = await createTeacherPlanner(gateway)(context, []);
  assert.ok(closed.ok, JSON.stringify(closed));
  assert.equal(state.callCount, 0);
  const direct = compileTeacherTurn(context, masteredScene);
  assert.ok(direct.ok);
  assert.deepEqual(direct.actions, closed.actions);
  assert.deepEqual(
    closed.actions.map(({ type }) => type),
    ['speak', 'keypoint_unverified', 'speak', 'keypoint_unverified', 'new_page', 'board'],
  );
  assert.equal(closed.trace.unverifiedStepId, closed.actions[1].step_id);

  const script = { keypoints: closed.keypoints, actions: [...context.played, ...closed.actions] };
  assert.ok(validateLessonScript(script));
  let stateAtCut = closed.initialState;
  for (const [index, next] of closed.actions.entries()) {
    const last = index === 0 ? context.played.at(-1) : closed.actions[index - 1];
    assert.ok(last);
    const cut = truncateOnInterrupt(script.actions, last.step_id);
    const resumed = compileTeacherTurn({
      ...context,
      played: cut.played,
      state: stateAtCut,
      input: { kind: 'interrupt', text: '等一下。' },
      progress: closed.progress,
    });
    assert.ok(resumed.ok, JSON.stringify(resumed));
    assert.ok(resumed.actions[0].step_id > closed.progress.highWater);
    assert.equal(cut.played.length + resumed.actions.length, 70);
    assert.deepEqual(
      resumed.actions.map(({ type }) => type),
      closed.actions.slice(index).map(({ type }) => type),
    );
    const updated = stateAfterScriptBeat(stateAtCut, next, false, script);
    assert.ok(updated, `closure beat ${index} cannot play`);
    stateAtCut = updated;
  }
  assert.equal(stateAtCut, 'completed');
});

test('forced close preserves an acknowledged pass and refuses an already over-limit legacy history', () => {
  const context = atBeat(66);
  const [, ...rest] = context.played;
  const played: Action[] = [
    { type: 'keypoint_complete', step_id: 10, keypoint_id: 'pairs' },
    ...rest,
  ];
  const closed = compileTeacherTurn({ ...context, played });
  assert.ok(closed.ok);
  assert.deepEqual(
    closed.actions.flatMap((beat) =>
      beat.type === 'keypoint_unverified' ? [beat.keypoint_id] : [],
    ),
    ['sum'],
  );
  assert.equal(closed.keypoints[0].status, 'completed');
  assert.equal(played.length + closed.actions.length, 70);

  const over = compileTeacherTurn(atBeat(71));
  assert.ok(!over.ok);
  assert.match(over.reasons.join(' '), /beat budget exhausted/);
});

test('an early cut with two beats of slack cannot turn a scheduled recap back into teaching', () => {
  const base = atBeat(62);
  const context: TeacherTurnContext = {
    ...base,
    played: [{ type: 'speak', step_id: 1, text: '换种说法。' }, ...base.played.slice(0, -1)],
    state: 'scaffold',
    input: { kind: 'interrupt', text: '稍等。' },
  };
  const closed = compileTeacherTurn(context);
  assert.ok(closed.ok);
  assert.deepEqual(
    closed.actions.map(({ type }) => type),
    ['speak', 'keypoint_unverified', 'speak', 'keypoint_unverified', 'new_page', 'board'],
  );
  const afterFirstOutcome = {
    ...context,
    state: 'diagnose' as const,
    played: [...context.played, ...closed.actions.slice(0, 2)],
    progress: closed.progress,
  };
  assert.equal(teacherTurnPolicy(afterFirstOutcome).phase, 'budget-close');
  const resumed = compileTeacherTurn(afterFirstOutcome);
  assert.ok(resumed.ok);
  assert.equal(resumed.actions.filter(({ type }) => type === 'keypoint_unverified').length, 1);
});
