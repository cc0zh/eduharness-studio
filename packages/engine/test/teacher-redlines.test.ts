import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectKeypointProgress } from '../src/lesson-playback.js';
import { compileTeacherTurn, type TeacherTurnContext } from '../src/teacher.js';
import {
  answeredContext,
  masteredScene,
  openingContext,
  scene,
  verifiedContext,
} from './teacher-scene-fixture.js';

function reject(context: TeacherTurnContext, input: unknown, reason?: RegExp) {
  const result = compileTeacherTurn(context, input);
  assert.equal(result.ok, false);
  if (!result.ok && reason) assert.match(result.reasons.join('\n'), reason);
}

test('only a substantive answer to the matched, played transfer question can precede mastery', () => {
  const result = compileTeacherTurn(verifiedContext, masteredScene);
  assert.ok(result.ok);
  assert.deepEqual(
    result.actions.map(({ type }) => type),
    ['speak', 'keypoint_complete', 'new_page', 'board', 'highlight', 'speak', 'ask'],
  );
  assert.deepEqual(result.actions.slice(0, 2), [
    { type: 'speak', checkpoint: 'verify', step_id: 11, text: masteredScene.resolution?.text },
    {
      type: 'keypoint_complete',
      step_id: 12,
      keypoint_id: 'pairs',
      summary: '两两配对后 仍有剩余的数是奇数。',
    },
  ]);
  assert.equal(result.actions[2].type === 'new_page' && result.actions[2].title, '和');
  for (const text of [
    '我不知道。',
    '我拿不准，给点提示。',
    "I don't know.",
    '请直接告诉我答案。',
    '不知道，能不能给我一个提示？',
    '好的。',
    '…',
    '嗯',
    '嗯，不知道。',
    '嗯！不知道。',
    "OK. I don't know.",
    '好吧，给点提示吧。',
  ]) {
    reject({ ...verifiedContext, input: { kind: 'answer', ask_step_id: 10, text } }, masteredScene);
  }
  reject(answeredContext, masteredScene);
  reject({ ...verifiedContext, played: [] }, masteredScene);
  reject(
    { ...verifiedContext, input: { kind: 'answer', ask_step_id: 11, text: '三对剩一个' } },
    masteredScene,
  );
  reject({ ...verifiedContext, input: { kind: 'interrupt', text: '我懂了' } }, masteredScene);
  reject(verifiedContext, { ...masteredScene, resolution: undefined }, /submitted together/);
  reject(
    verifiedContext,
    { ...masteredScene, diagnosis: scene('misconception').diagnosis },
    /submitted together/,
  );
  assert.ok(
    compileTeacherTurn(
      { ...verifiedContext, input: { kind: 'answer', ask_step_id: 10, text: '3' } },
      masteredScene,
    ).ok,
  );
});

test('prerequisite insertion is bounded and cannot ask for a transfer of the old point', () => {
  const inserted = {
    ...scene('missing_prereq'),
    insert_keypoint: { id: 'groups', title: '会分组', objective: '两块一组', depth: 'intuition' },
  };
  const result = compileTeacherTurn(answeredContext, inserted);
  assert.ok(result.ok);
  assert.deepEqual(
    result.keypoints.map(({ id, status }) => [id, status]),
    [
      ['groups', 'active'],
      ['pairs', 'pending'],
      ['sum', 'pending'],
    ],
  );
  assert.deepEqual(result.trace.inserted, { id: 'groups', title: '会分组', before: 'pairs' });
  assert.equal(result.actions[0].type === 'new_page' && result.actions[0].title, '会分组');
  reject(
    { ...answeredContext, progress: { ...answeredContext.progress, insertedCount: 2 } },
    inserted,
    /insert_keypoint/,
  );
  const six = [
    ...openingContext.keypoints,
    ...[1, 2, 3, 4].map((i) => ({ ...openingContext.keypoints[1], id: `extra-${i}` })),
  ];
  reject({ ...answeredContext, keypoints: six }, inserted, /insert_keypoint/);
  reject(
    answeredContext,
    { ...inserted, diagnosis: scene('clarifying').diagnosis },
    /prerequisite/,
  );
  reject(
    answeredContext,
    { ...inserted, next_ask: { prompt: '新的数字呢？', transfer: true } },
    /same active point/,
  );
});

test('first low effort must be binary; consecutive low effort or explicit skip cannot claim mastery', () => {
  const low: TeacherTurnContext = {
    ...verifiedContext,
    input: { kind: 'answer', ask_step_id: 10, text: '１！' },
  };
  reject(low, masteredScene);
  reject(low, { ...scene('low_effort'), next_ask: { prompt: '说说你的思路？' } }, /options/);
  const first = compileTeacherTurn(low, scene('low_effort'));
  assert.ok(first.ok);
  const ask = first.actions.at(-1);
  assert.ok(ask?.type === 'ask' && ask.mode === 'choice');
  assert.equal(ask.options?.length, 2);
  assert.equal(ask.checkpoint, undefined);
  assert.equal(first.trace.unverified, undefined);
  const second = compileTeacherTurn(
    {
      ...low,
      played: [...low.played, ...first.actions],
      input: { kind: 'answer', ask_step_id: ask.step_id, text: '继续' },
      progress: first.progress,
    },
    scene('low_effort'),
  );
  assert.ok(second.ok);
  assert.equal(second.progress.lowEffortStreak, 2);
  assert.equal(second.trace.unverified, 'pairs');
  assert.equal(second.trace.unverifiedStepId, second.actions[1].step_id);
  assert.deepEqual(
    projectKeypointProgress(low.keypoints, second.actions).keypoints.map(({ status }) => status),
    ['unverified', 'active'],
  );
  const clickedSkip = {
    ...low,
    input: { kind: 'answer' as const, ask_step_id: 10, text: '跳过这题', choice: true },
  };
  const skipped = compileTeacherTurn(clickedSkip, scene('low_effort'));
  assert.ok(skipped.ok && skipped.trace.unverified === 'pairs');
});

test('opening blocks explicit reveals but accepts positive test results as a scenario', () => {
  const input = scene();
  input.panels = [
    {
      title: '检测结果',
      content: '某次筛查检测结果是阳性，复查化验结果为阳性，样本结果：待核对。',
      voiceover: '检测结果是阳性时，患病概率一定很高吗？',
    },
  ];
  assert.ok(compileTeacherTurn(openingContext, input).ok);
  for (const reveal of [
    '正确答案是第二个。',
    '最终结果是 31%。',
    'The answer is 3.',
    '**正确答案**：C',
  ]) {
    reject(
      openingContext,
      { ...input, panels: [{ ...input.panels[0], voiceover: reveal }] },
      /reveals the answer/,
    );
  }
  reject(
    openingContext,
    { ...input, next_ask: { prompt: '你会先查哪个数？', hint: '正确选项是 B。' } },
    /reveals the answer/,
  );
  reject(
    openingContext,
    {
      ...input,
      panels: [
        {
          ...input.panels[0],
          diagram: { diagram_kind: 'distribution', description: '把最终结果：42写在图上。' },
        },
      ],
    },
    /reveals the answer/,
  );
});

test('opening distinguishes an answer question from a reversed explicit answer assertion', () => {
  const input = scene();
  for (const prompt of [
    '你认为答案是什么？',
    '哪个选项是正确答案？',
    'What do you think the answer is?',
  ]) {
    assert.ok(compileTeacherTurn(openingContext, { ...input, next_ask: { prompt } }).ok, prompt);
  }
  for (const text of ['B 是正确答案。', '第二项为正确的答案。', 'B is the correct answer.']) {
    reject(
      openingContext,
      { ...input, panels: [{ ...input.panels[0], voiceover: text }] },
      /reveals the answer/,
    );
  }
});
