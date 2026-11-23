import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type Action,
  canTransition,
  PROTOCOL_VERSION,
  projectActionsToPublicDialogue,
  truncateOnInterrupt,
  validateActions,
  validateBlueprint,
} from '../src/index.js';

test('validates structured action batch and rejects malformed actions', () => {
  assert.equal(PROTOCOL_VERSION, '0.1.0');
  const valid: Action[] = [
    {
      type: 'board',
      step_id: 1,
      column: 1,
      card_id: 'card-1',
      title: '1. 概念拆解',
      depth: 'intuition',
      content: '边 AD 位于直线 x = 0 上',
    },
    {
      type: 'highlight',
      step_id: 2,
      card_id: 'card-1',
      target_text: '线段 AE ≠ 垂距',
      style: 'circle',
    },
    {
      type: 'speak',
      step_id: 3,
      text: '先看边 AD 的位置，不要把斜边 AE 当作垂距。',
    },
    {
      type: 'ask',
      step_id: 4,
      card_id: 'card-3',
      prompt: '哪个坐标直接决定点 E 到边 AD 的垂距？',
      mode: 'open',
    },
  ];
  const ok = validateActions(valid);
  assert.equal(ok.ok, true);

  const bad = validateActions([{ type: 'speak', step_id: 0, text: '' }]);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length > 0);
});

test('validates two-layer dynamic course blueprint with arbitrary unit/lesson counts', () => {
  const res = validateBlueprint({
    id: 'course-geo-1',
    title: '解析几何：点到直线的距离',
    topic: '点到直线距离',
    units: [
      {
        id: 'u1',
        title: '单元 01 · 建立几何直觉',
        lessons: [
          {
            id: 'l1',
            title: '矩形内点 E 到边 AD 的垂距',
            summary: '区分斜线段与水平垂线段',
            depth: 'intuition',
            status: 'ready',
            estimatedMinutes: 8,
          },
          {
            id: 'l2',
            title: '推广到任意竖直边 x = x_A',
            summary: '用绝对值表达水平垂距',
            depth: 'derivation',
            status: 'locked',
          },
        ],
      },
    ],
  });
  assert.equal(res.ok, true);
});

test('enforces teaching state transitions and mid-beat interrupt truncation', () => {
  assert.equal(canTransition('intake', 'diagnose'), true);
  assert.equal(canTransition('diagnose', 'completed'), false);
  assert.equal(canTransition('verify', 'completed'), true);
  assert.equal(canTransition('completed', 'scaffold'), false);

  const queue: Action[] = [
    { type: 'speak', step_id: 1, text: '第 1 拍' },
    { type: 'speak', step_id: 2, text: '第 2 拍' },
    { type: 'ask', step_id: 3, card_id: 'c3', prompt: '第 3 拍提问', mode: 'open' },
  ];
  const cut = truncateOnInterrupt(queue, 2);
  assert.deepEqual(
    cut.played.map((a) => a.step_id),
    [1, 2],
  );
  assert.deepEqual(
    cut.truncated.map((a) => a.step_id),
    [3],
  );
  assert.equal(cut.lastPlayedStepId, 2);
});

test('projects played whiteboard actions and learner replies into numbered public dialogue', () => {
  const turns = projectActionsToPublicDialogue([
    {
      kind: 'teacher_turn',
      actions: [
        {
          type: 'board',
          step_id: 1,
          column: 1,
          card_id: 'c1',
          title: '概念拆解',
          content: '边 AD 在 x = 0',
        },
        { type: 'speak', step_id: 2, text: '先看这条边。' },
        {
          type: 'ask',
          step_id: 3,
          card_id: 'c2',
          prompt: '点 E 到 AD 的垂距看哪个坐标？',
          mode: 'open',
        },
      ],
    },
    { kind: 'learner_turn', text: '看横坐标 x_E！', interrupted: false },
  ]);

  assert.equal(turns.length, 2);
  assert.equal(turns[0].turnNumber, 1);
  assert.equal(turns[0].role, 'teacher');
  assert.deepEqual(turns[0].evidenceStepIds, [1, 2, 3]);
  assert.match(turns[0].text, /\[板书: 概念拆解\]/);
  assert.match(turns[0].text, /\[提问\]/);
  assert.equal(turns[1].turnNumber, 2);
  assert.equal(turns[1].role, 'learner');
  assert.equal(turns[1].text, '看横坐标 x_E！');
});
