import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  projectKeypointProgress,
  stateAfterScriptBeat,
  validateLessonScript,
} from '../src/lesson-playback.js';
import { canTransition, truncateOnInterrupt } from '../src/state.js';
import {
  compileTeacherTurn,
  type TeacherTurnContext,
  type TeacherTurnOutput,
  teacherTurnPolicy,
} from '../src/teacher.js';
import type { TurnPolicy } from '../src/teacher-semantics.js';
import { openingContext, scene } from './teacher-scene-fixture.js';

const styles = ['mastery', 'stuck', 'interrupt', 'prerequisite', 'low-effort'] as const;
type Style = (typeof styles)[number];
const limit = 70; // Acceptance bound, independent of the implementation constant.

function seeded(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) % max;
  };
}

function learner(style: Style, context: TeacherTurnContext, turn: number): string {
  if (style === 'stuck') return '我不会做';
  if (style === 'low-effort') {
    if (turn === 1) return ' １！ ';
    return context.progress.lowEffortStreak ? ' 继续吧。 ' : ' skip this! ';
  }
  return `我试着解释第 ${turn} 个例子的关系。`;
}

function proposal(
  context: TeacherTurnContext,
  policy: TurnPolicy,
  style: Style,
  turn: number,
  random: ReturnType<typeof seeded>,
): TeacherTurnOutput {
  const { phase, pacing, schema } = policy;
  const ask = context.played.at(-1);
  const answered = context.input.kind === 'answer' && ask?.type === 'ask';
  const passed =
    answered && ask.checkpoint === 'verify' && (style === 'mastery' || style === 'prerequisite');
  const insert =
    style === 'prerequisite' && !passed && Object.hasOwn(schema.properties, 'insert_keypoint');
  let status: TeacherTurnOutput['diagnosis']['status'] = 'misconception';
  if (phase === 'opening') status = 'opening';
  else if (phase === 'unverified' || phase === 'first-low-effort') status = 'low_effort';
  else if (passed) status = 'mastered';
  else if (style === 'prerequisite' && answered) status = 'missing_prereq';
  const panel = scene().panels[0];
  const panels = Array.from(
    { length: 1 + random(schema.properties.panels.maxItems ?? 1) },
    (_, index) => ({
      ...panel,
      title: `例子 ${turn}.${index}`,
      ...(random(3) === 0 ? { voiceover: undefined } : {}),
      ...(random(3) === 0 ? { highlight: undefined } : {}),
    }),
  );
  const transfer =
    answered && !ask.checkpoint && !insert && (style === 'mastery' || style === 'prerequisite');
  const nextAsk: TeacherTurnOutput['next_ask'] = {
    prompt: `比较第 ${turn} 个例子，你看到了什么？`,
    ...(phase === 'first-low-effort' ? { options: ['甲', '乙'] } : {}),
    ...(transfer ? { transfer: true } : {}),
  };
  const output: TeacherTurnOutput = { diagnosis: scene(status).diagnosis, panels };
  if (passed) output.resolution = { text: '你给出了理由。', conclusion: `结论 ${turn}。` };
  if (insert) {
    output.insert_keypoint = {
      id: `prereq-${turn}`,
      title: `前置 ${turn}`,
      objective: '能分组。',
      depth: 'intuition',
    };
  }
  if (!(passed || phase === 'unverified') || pacing.openPoints > 1) output.next_ask = nextAsk;
  return output;
}

function trajectory(seed: number, style: Style, fixedCount?: number) {
  const random = seeded(seed);
  const count = fixedCount ?? (style === 'prerequisite' ? 2 : 2 + random(3));
  let context: TeacherTurnContext = {
    ...openingContext,
    seed: `${style}:${seed}`,
    keypoints: Array.from({ length: count }, (_, index) => ({
      ...openingContext.keypoints[index % 2],
      id: `point-${index}`,
      title: `要点 ${index}`,
      status: index ? 'pending' : 'active',
    })),
  };
  let inserts = 0;
  let interrupts = 0;
  let budgetCloses = 0;
  let reduced = 0;
  let retries = 0;
  let firstLowEffort = 0;
  let skips = 0;
  let repeats = 0;
  for (let turn = 0; turn < 70; turn++) {
    const policy = teacherTurnPolicy(context);
    const closing = policy.phase === 'budget-close';
    budgetCloses += Number(closing);
    firstLowEffort += Number(policy.phase === 'first-low-effort');
    if (policy.phase === 'unverified' && context.input.kind === 'answer') {
      if (context.input.text.includes('skip')) skips++;
      else repeats++;
    }
    if (!closing && policy.schema.properties.panels.maxItems === 1) reduced++;
    const input = closing ? undefined : proposal(context, policy, style, turn, random);
    let result = compileTeacherTurn(context, input);
    if (!result.ok && input) {
      assert.match(result.reasons.join(' '), /beat budget exceeded/);
      retries++;
      result = compileTeacherTurn(context, {
        ...input,
        panels: [{ title: '比较', content: '只保留一个例子。' }],
      });
    }
    assert.ok(result.ok, `${seed}/${style}/${turn}: ${JSON.stringify(result)}`);
    const script = { keypoints: result.keypoints, actions: [...context.played, ...result.actions] };
    assert.ok(validateLessonScript(script));
    assert.ok(script.actions.length <= limit);
    let state = result.initialState;
    assert.ok(canTransition(context.state, state));

    const interrupt =
      style === 'interrupt' && result.actions.length > 1 && (turn === 0 || random(3) === 0);
    const length = interrupt ? 1 + random(result.actions.length - 1) : result.actions.length;
    for (const [index, beat] of result.actions.entries()) {
      if (beat.type === 'keypoint_complete') {
        const ask = context.played.at(-1);
        assert.ok(ask?.type === 'ask' && ask.checkpoint === 'verify');
        assert.ok(context.input.kind === 'answer' && context.input.ask_step_id === ask.step_id);
        const prior = result.actions[index - 1];
        assert.ok(prior?.type === 'speak' && prior.checkpoint === 'verify');
      }
      if (index < length) {
        const next = stateAfterScriptBeat(state, beat, false, script);
        assert.ok(next, `invalid playback for ${seed}/${style}/${turn} at ${beat.type}`);
        assert.ok(canTransition(state, next));
        state = next;
      }
    }

    const last = result.actions[length - 1];
    const { played, truncated } = truncateOnInterrupt(script.actions, last.step_id);
    const progress = {
      ...result.progress,
      lowEffortStreak: result.actions
        .slice(0, length)
        .some(({ type }) => type === 'keypoint_unverified')
        ? 0
        : result.progress.lowEffortStreak,
      truncatedCardIds: [
        ...result.progress.truncatedCardIds,
        ...truncated.flatMap((action) => {
          if (action.type === 'new_page') return [action.page_id];
          return 'card_id' in action ? [action.card_id] : [];
        }),
      ],
    };
    inserts += Number(Boolean(result.trace.inserted));
    interrupts += Number(interrupt);
    context = { ...context, keypoints: script.keypoints, played, progress, state };
    if (state === 'completed') {
      assert.ok(!interrupt);
      const { keypoints } = projectKeypointProgress(context.keypoints, played);
      assert.ok(keypoints.every(({ status }) => status === 'completed' || status === 'unverified'));
      assert.ok(validateLessonScript({ keypoints, actions: [...played] }));
      return {
        beats: played.length,
        mastered: keypoints.filter(({ status }) => status === 'completed').length,
        unverified: keypoints.filter(({ status }) => status === 'unverified').length,
        inserts,
        interrupts,
        reduced,
        budgetCloses,
        retries,
        firstLowEffort,
        skips,
        repeats,
        turns: turn + 1,
      };
    }
    if (interrupt) {
      context.generation++;
      context.input = { kind: 'interrupt', text: '先换一种说法。' };
    } else {
      assert.equal(state, 'handoff');
      assert.equal(last.type, 'ask');
      context.input = {
        kind: 'answer',
        ask_step_id: last.step_id,
        text: learner(style, context, turn + 1),
      };
    }
  }
  assert.fail(`${seed}/${style} did not finish`);
}

for (const style of styles) {
  test(`24 seeded multi-turn trajectories: ${style}`, (t) => {
    const results = Array.from({ length: 24 }, (_, i) => trajectory(5000 + i * 7919, style));
    for (const result of results) {
      assert.ok(result.beats <= limit);
      if (style === 'mastery') assert.ok(result.mastered >= 2 && result.unverified === 0);
      if (style === 'stuck')
        assert.ok(result.budgetCloses && result.reduced && result.mastered === 0);
      if (style === 'interrupt') assert.ok(result.interrupts && result.mastered === 0);
      if (style === 'prerequisite') assert.ok(result.inserts && result.mastered >= 2);
      if (style === 'low-effort') {
        assert.ok(result.firstLowEffort && result.repeats && result.skips);
        assert.ok(result.unverified >= 2 && result.mastered === 0);
      }
    }
    const beats = results.map((result) => result.beats);
    const retries = results.reduce((total, result) => total + result.retries, 0);
    t.diagnostic(
      `24 cases; ${Math.min(...beats)}–${Math.max(...beats)} beats; ${retries} oversize scenes retried`,
    );
  });
}

test('a two-point micro-lesson under repeated dense scenes cannot recreate the recorded 81 beats', (t) => {
  const result = trajectory(8136, 'stuck', 2);
  assert.equal(result.unverified, 2);
  assert.equal(result.mastered, 0);
  assert.ok(result.turns >= 8);
  assert.ok(result.budgetCloses);
  assert.ok(result.beats <= limit);
  t.diagnostic(`${result.beats} beats over ${result.turns} turns, both points honestly unverified`);
});
