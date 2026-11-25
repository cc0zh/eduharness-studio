import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KindGuard, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Action } from '../src/protocol.js';
import { compileTeacherTurn, type TeacherTurnContext, teacherTurnPolicy } from '../src/teacher.js';
import { playedConclusions } from '../src/teacher-context.js';
import { teacherPrompt } from '../src/teacher-prompt.js';
import {
  answeredContext,
  masteredScene,
  openingContext,
  scene,
  verifiedContext,
} from './teacher-scene-fixture.js';

function schemaPaths(schema: TSchema, prefix = ''): string[] {
  if (KindGuard.IsArray(schema)) return schemaPaths(schema.items, `${prefix}[]`);
  if (!KindGuard.IsObject(schema)) return [];
  return Object.entries(schema.properties).flatMap(([key, field]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [`${path}${schema.required?.includes(key) ? '' : '?'}`, ...schemaPaths(field, path)];
  });
}

const interrupted: TeacherTurnContext = {
  ...answeredContext,
  input: { kind: 'interrupt', text: '刚才的例子是什么意思？' },
};
const firstLow: TeacherTurnContext = {
  ...answeredContext,
  input: { kind: 'answer', ask_step_id: 10, text: '继续' },
};
const finalPoint: TeacherTurnContext = {
  ...verifiedContext,
  played: [
    { type: 'keypoint_complete', step_id: 5, keypoint_id: 'pairs' },
    ...verifiedContext.played,
  ],
};
const finalSkip: TeacherTurnContext = {
  ...finalPoint,
  input: { kind: 'answer', ask_step_id: 10, text: '跳过' },
};

const variants: [string, TeacherTurnContext, string[]][] = [
  ['opening', openingContext, ['next_ask', 'diagram']],
  ['ordinary answered', answeredContext, ['insert_keypoint', 'next_ask', 'transfer', 'diagram']],
  [
    'matching substantive verify',
    verifiedContext,
    ['resolution', 'insert_keypoint', 'next_ask', 'diagram'],
  ],
  [
    'unanswered verify',
    {
      ...verifiedContext,
      input: { kind: 'answer', ask_step_id: 10, text: '我不确定，给点提示。' },
    },
    ['insert_keypoint', 'next_ask', 'diagram'],
  ],
  ['interrupt', interrupted, ['next_ask', 'diagram']],
  ['first low effort', firstLow, ['next_ask']],
  [
    'repeated low effort',
    { ...firstLow, progress: { ...firstLow.progress, lowEffortStreak: 1 } },
    ['next_ask'],
  ],
  ['last point, verify', finalPoint, ['resolution', 'insert_keypoint', 'next_ask', 'diagram']],
  ['last point, skip', finalSkip, []],
  [
    'insertion cap',
    { ...answeredContext, progress: { ...answeredContext.progress, insertedCount: 2 } },
    ['next_ask', 'transfer', 'diagram'],
  ],
];

for (const [name, context, enabled] of variants) {
  test(`schema and full prompt agree on every Scene IR field: ${name}`, () => {
    const policy = teacherTurnPolicy(context);
    const prompt = teacherPrompt(context, policy, [], [], true, [], 0);
    const allowed = schemaPaths(policy.schema).sort();
    const rendered = [...prompt.matchAll(/^([a-z_][a-z_.[\]]*\??)：/gm)]
      .map(([, path]) => path)
      .sort();
    assert.deepEqual(rendered, allowed);
    for (const field of ['resolution', 'insert_keypoint', 'next_ask', 'transfer', 'diagram']) {
      assert.equal(new RegExp(`\\b${field}\\b`).test(prompt), enabled.includes(field), field);
    }
    assert.doesNotMatch(
      prompt,
      /\b(?:actions|card_id|page_id|step_id|checkpoint|verify_feedback|boards|spoken)\b/,
    );
    assert.match(prompt, /panels：1–3 项列表/);
    assert.match(prompt, /panels\[\]\.title：文本，≤48 字/);
  });
}

test('policy schema requires exactly two choices initially and prunes the last skipped point handoff', () => {
  const low = scene('low_effort');
  const schema = teacherTurnPolicy(firstLow).schema;
  assert.ok(Value.Check(schema, low));
  assert.equal(
    Value.Check(schema, {
      ...low,
      next_ask: { prompt: '你怎么判断？', options: ['甲', '乙', '丙'] },
    }),
    false,
  );
  assert.match(
    teacherPrompt(firstLow, teacherTurnPolicy(firstLow), [], [], false, [], 0),
    /next_ask\.options：2 项列表/,
  );
  assert.equal(Value.Check(teacherTurnPolicy(finalSkip).schema, low), false);
  assert.ok(
    Value.Check(teacherTurnPolicy(finalSkip).schema, {
      diagnosis: low.diagnosis,
      panels: low.panels,
    }),
  );
  const finalPrompt = teacherPrompt(
    finalPoint,
    teacherTurnPolicy(finalPoint),
    [],
    [],
    false,
    [],
    0,
  );
  assert.match(finalPrompt, /^next_ask\?：/m);
  assert.match(finalPrompt, /^diagnosis\.status：.*"mastered"/m);
});

test('working memory includes only one-line conclusions from acknowledged passes, limited to four', () => {
  const recorded: Action[] = [1, 2, 3, 4, 5].map((i) => ({
    type: 'keypoint_complete',
    step_id: i,
    keypoint_id: `kp${i}`,
    summary: `  结论${i}\n第二短句  `,
  }));
  recorded.push({ type: 'keypoint_unverified', step_id: 6, keypoint_id: 'unverified-point' });
  assert.deepEqual(
    playedConclusions(recorded),
    [2, 3, 4, 5].map((i) => `结论${i} 第二短句`),
  );

  const passed = compileTeacherTurn(verifiedContext, masteredScene);
  assert.ok(passed.ok);
  const promptThrough = (count: number) => {
    const context = {
      ...interrupted,
      played: [...verifiedContext.played, ...passed.actions.slice(0, count)],
    };
    return teacherPrompt(context, teacherTurnPolicy(context), [], [], false, [], 0);
  };
  assert.match(promptThrough(1), /"workingMemory":\[\]/);
  assert.match(promptThrough(2), /"workingMemory":\["两两配对后 仍有剩余的数是奇数。"\]/);
  assert.doesNotMatch(promptThrough(2), /想象桌面上有五块积木/);
});
