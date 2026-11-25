import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCourseLessonPlanner, validateLessonMaterial } from '../src/course.js';
import type { CourseBlueprint, LessonRef } from '../src/protocol.js';
import { fauxResult, localFaux, scene } from './teacher-scene-fixture.js';

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

function draft() {
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
      ...scene(),
      panels: [
        { title: '筛查结果', content: '先分清患病与阳性。', voiceover: '假阳性也会进入阳性组。' },
      ],
      next_ask: { prompt: '阳性者中有多少真正患病？' },
    },
  };
}

test('lazy lesson retries a revealing opening before materializing or unlocking it', async () => {
  const faux = localFaux();
  const valid = draft();
  faux.setResponses([
    fauxResult({
      ...valid,
      opening: {
        ...valid.opening,
        panels: [{ ...valid.opening.panels[0], voiceover: '正确答案是 B。' }],
      },
    }),
    fauxResult(valid),
  ]);
  const result = await createCourseLessonPlanner(
    faux.gateway,
    {},
  )({ course, lesson, previousKeypoints: [] });
  assert.equal(faux.state.callCount, 2);
  assert.match(
    result.material.openingEvidence?.guardrails[0]?.reasons.join(' ') ?? '',
    /reveals the answer/,
  );
  assert.equal(result.material.script.actions.at(-1)?.type, 'ask');
  assert.equal(result.material.script.actions[0].type, 'board');
});

test('lazy opening uses the same pruned scene contract on the first request and correction', async () => {
  const faux = localFaux();
  const invalid = draft();
  const prompts: string[] = [];
  faux.setResponses([
    (request) => {
      prompts.push(String(request.messages.find(({ role }) => role === 'user')?.content));
      return fauxResult({
        ...invalid,
        opening: {
          ...invalid.opening,
          insert_keypoint: {
            id: 'prerequisite',
            title: '认出阳性',
            objective: '识别阳性的样本。',
            depth: 'intuition',
          },
          next_ask: { ...invalid.opening.next_ask, transfer: true },
        },
      });
    },
    (request) => {
      prompts.push(String(request.messages.find(({ role }) => role === 'user')?.content));
      const good = draft();
      return fauxResult({
        ...good,
        opening: {
          ...good.opening,
          unused: 'discard me',
          panels: [{ ...good.opening.panels[0], formula: '  ' }],
        },
      });
    },
  ]);
  const { material } = await createCourseLessonPlanner(
    faux.gateway,
    {},
  )({ course, lesson, previousKeypoints: [] });
  for (const prompt of prompts) {
    assert.match(prompt, /ONLY top-level keys keypoints/);
    assert.match(prompt, /panels：1–3 项列表/);
    assert.doesNotMatch(prompt, /insert_keypoint|resolution|transfer|keypoint_complete|checkpoint/);
  }
  assert.match(prompts[1], /previous submission was invalid/);
  const reasons = material.openingEvidence?.guardrails[0]?.reasons.join(' ') ?? '';
  assert.match(reasons, /opening.insert_keypoint: unexpected field/);
  assert.match(reasons, /opening.next_ask.transfer: unexpected field/);
  assert.ok(validateLessonMaterial(material));
  assert.equal(faux.state.callCount, 2);
});

test('stored opening failures remain valid bounded X-Ray evidence', async () => {
  const faux = localFaux();
  const output = draft();
  const panels = Array.from({ length: 4 }, () => ({
    title: '标题'.repeat(25),
    content: '板书'.repeat(141),
    voiceover: '字幕'.repeat(90),
  }));
  faux.setResponses([
    fauxResult({ ...output, opening: { ...output.opening, panels } }),
    fauxResult(output),
  ]);
  const { material } = await createCourseLessonPlanner(
    faux.gateway,
    {},
  )({ course, lesson, previousKeypoints: [] });
  const reasons = material.openingEvidence?.guardrails[0]?.reasons ?? [];
  assert.ok(reasons.length > 0 && reasons.length <= 20);
  assert.match(reasons.join(' '), /panels: too many items/);
  assert.ok(validateLessonMaterial(material));
  assert.equal(faux.state.callCount, 2);
});

test('live planning rejects five points and accepts four genuine, distinct points after correction', async () => {
  const faux = localFaux();
  const output = draft();
  const four = [
    ...output.keypoints,
    {
      id: 'false-positive',
      title: '估算假阳性',
      objective: '比较阳性人数与假阳性人数。',
      depth: 'application',
    },
    {
      id: 'new-population',
      title: '对比另一人群',
      objective: '解释基数率改变后的筛查结果。',
      depth: 'theory',
    },
  ];
  const duplicate = [...four.slice(0, 3), { ...four[3], title: ` ${four[0].title}。` }];
  faux.setResponses([
    fauxResult({
      ...output,
      keypoints: [
        ...four,
        { id: 'fifth', title: '复查', objective: '复查结果。', depth: 'application' },
      ],
    }),
    fauxResult({ ...output, keypoints: duplicate }),
    fauxResult({ ...output, keypoints: four }),
  ]);
  const { material } = await createCourseLessonPlanner(
    faux.gateway,
    {},
  )({ course, lesson, previousKeypoints: [] });
  assert.equal(faux.state.callCount, 3);
  assert.deepEqual(
    material.script.keypoints.map(({ id }) => id),
    four.map(({ id }) => id),
  );
  const [overLimit, repeated] = material.openingEvidence?.guardrails ?? [];
  assert.match(overLimit?.reasons.join(' ') ?? '', /keypoints: too many items/);
  assert.match(repeated?.reasons.join(' ') ?? '', /distinct/);
  assert.equal(material.basis, undefined);
});
