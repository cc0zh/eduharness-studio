import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCourseLessonPlanner, validateLessonMaterial } from '../src/course.js';
import { createFauxModelGateway, fauxAssistantMessage, fauxToolCall } from '../src/models.js';
import type { CourseBlueprint, LessonRef } from '../src/protocol.js';

const course: CourseBlueprint = {
  id: 'course-test',
  title: '贝叶斯检测',
  topic: '贝叶斯检测',
  units: [
    {
      id: 'unit-1',
      title: '条件概率',
      lessons: [
        {
          id: 'lesson-2',
          title: '阳性预测值',
          summary: '比较阳性预测值和基数率。',
          depth: 'application',
          status: 'ready',
        },
      ],
    },
  ],
};

const lesson: LessonRef = course.units[0].lessons[0];

function draft(duplicateAskId = false) {
  return {
    keypoints: [
      { id: 'base-rate', title: '基数率', objective: '辨认患病率。', depth: 'intuition' },
      {
        id: 'positive-value',
        title: '阳性预测值',
        objective: '计算阳性后的概率。',
        depth: 'application',
      },
    ],
    opening: {
      diagnosis: {
        status: 'opening',
        summary: '先列出阳性和阴性样本。',
        strategy: '用混淆矩阵区分条件概率。',
      },
      actions: [
        { type: 'board', column: 1, card_id: 'matrix', content: '先分清患病与阳性。' },
        { type: 'speak', text: '假阳性也会进入阳性组。' },
        { type: 'speak', text: '基数率决定阳性组的构成。' },
        {
          type: 'ask',
          card_id: duplicateAskId ? 'matrix' : 'question',
          mode: 'open',
          prompt: '阳性者中有多少真正患病？',
        },
      ],
    },
  } as const;
}

function oversizedDraftReasons() {
  const output = draft();
  return {
    ...output,
    opening: {
      ...output.opening,
      actions: Array.from({ length: 8 }, (_, index) => ({
        type: 'board' as const,
        column: 1,
        card_id: `reused-${index === 0 ? 'first' : 'same'}`,
        title: '标题'.repeat(25),
        content: '板书'.repeat(91),
      })),
    },
  };
}

const encoded = (value: Parameters<typeof fauxToolCall>[1]['value']) =>
  fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });

test('lazy lesson retries a rejected opening turn before materializing or unlocking it', async () => {
  const faux = createFauxModelGateway();
  assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-test-key' }));
  faux.setResponses([encoded(draft(true)), encoded(draft())]);
  const plan = createCourseLessonPlanner(faux.gateway, {});
  const result = await plan({ course, lesson, previousKeypoints: [] });
  assert.equal(faux.state.callCount, 2);
  assert.deepEqual(result.material.openingEvidence?.guardrails, [
    {
      attempt: 1,
      reasons: [
        'actions[3]: ask.card_id must be new and distinct from all board and ask cards, including cards from a truncated beat',
      ],
    },
  ]);
  assert.equal(result.material.script.actions.at(-1)?.type, 'ask');
  assert.equal(result.material.script.actions[0].type, 'board');
});

test('stored opening retry diagnostics stay within the material schema reason cap', async () => {
  const faux = createFauxModelGateway();
  assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-test-key' }));
  faux.setResponses([encoded(oversizedDraftReasons()), encoded(draft())]);
  const result = await createCourseLessonPlanner(
    faux.gateway,
    {},
  )({
    course,
    lesson,
    previousKeypoints: [],
  });
  const reasons = result.material.openingEvidence?.guardrails[0]?.reasons;
  assert.equal(reasons?.length, 20);
  assert.ok(validateLessonMaterial(result.material));
  assert.equal(faux.state.callCount, 2);
});
