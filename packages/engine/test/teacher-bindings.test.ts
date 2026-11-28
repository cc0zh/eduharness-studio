import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTeacherTurn, type TeacherTurnOutput } from '../src/teacher.js';
import {
  answeredContext,
  masteredScene,
  openingContext,
  scene,
  verifiedContext,
} from './teacher-scene-fixture.js';

type Panel = TeacherTurnOutput['panels'][number];
const compile = (fields: Partial<Panel>) =>
  compileTeacherTurn(answeredContext, {
    ...scene('clarifying'),
    panels: [{ title: '核算', content: '核对等式。', ...fields }],
  });

test('one precise binding writes the same value into content, formula and voiceover only', () => {
  const result = compile({
    bindings: [{ key: 'people', expression: '25000-600' }],
    content: '余下 {{people}} 人。',
    formula: String.raw`\text{余下人数}=25000-600={{people}}`,
    voiceover: '这一步留下 {{people}} 人。',
    quoted_error: '误算：25000-600=24401。{{people}} 在这里不解释。',
  });
  assert.ok(result.ok);
  const board = result.actions.find((action) => action.type === 'board');
  assert.match(board?.content ?? '', /^余下 24400 人。\n\n\*\*学生错算/);
  assert.match(board?.content ?? '', /24401。\{\{people\}\}/);
  assert.equal(board?.formula, String.raw`\text{余下人数}=25000-600=24400`);
  assert.ok(
    result.actions.some(
      (action) => action.type === 'speak' && action.text === '这一步留下 24400 人。',
    ),
  );
  assert.ok(
    result.actions.every((action) => !('bindings' in action) && !('quoted_error' in action)),
  );
});

test('fraction and negative bindings are atomic in a TeX expression', () => {
  const result = compile({
    bindings: [
      { key: 'ratio', expression: '2/3' },
      { key: 'negative', expression: '-2' },
    ],
    content: '比率为 {{ratio}}，负数为 {{negative}}。',
    formula: '{{ratio}}^2+{{negative}}^2=40/9',
  });
  assert.ok(result.ok, result.ok ? undefined : result.reasons.join('\n'));
  assert.equal(
    result.actions.find((action) => action.type === 'board')?.formula,
    String.raw`\frac{2}{3}^2+(-2)^2=40/9`,
  );
});

test('bad, ambiguous, or unbound templates fail with field diagnostics before playback', () => {
  const duplicate = { key: 'same', expression: '2+2' };
  for (const [fields, pattern] of [
    [{ content: '结果 {{missing}}' }, /content: undeclared key/],
    [{ bindings: [duplicate, duplicate] }, /bindings\[1\]\.key: duplicate/],
    [
      { bindings: [{ key: 'bad', expression: '1/0' }] },
      /bindings\[0\]\.expression: Cannot divide by zero/,
    ],
    [
      { bindings: [{ key: 'bad', expression: 'sqrt(2)' }] },
      /bindings\[0\]\.expression: no exact result/,
    ],
    [
      { bindings: [{ key: 'bad', expression: '1/3', format: 'decimal' }] },
      /bindings\[0\]\.expression: no exact result/,
    ],
    [
      { bindings: [duplicate], content: '结果是 {{same}}。', formula: '2+2=5' },
      /formula.*4, not 5/,
    ],
  ] satisfies [Partial<Panel>, RegExp][]) {
    const result = compile(fields);
    assert.ok(!result.ok);
    assert.match(result.reasons.join('\n'), pattern);
    assert.ok(!('actions' in result));
  }
});

test('bindings are panel-local and binding/template internals never enter accepted actions', () => {
  const input = scene('clarifying');
  const result = compileTeacherTurn(answeredContext, {
    ...input,
    panels: [
      {
        title: '一',
        content: '{{quantity}} 人。',
        bindings: [{ key: 'quantity', expression: '1' }],
      },
      { title: '二', content: '{{quantity}} 人。' },
    ],
  });
  assert.ok(!result.ok);
  assert.match(result.reasons.join('\n'), /panels\[1\]\.content: undeclared key/);
});

test('all malformed binding placeholders are rejected in the three interpolated fields', () => {
  const bindings = [{ key: 'total', expression: '8+4' }];
  for (const field of ['content', 'formula', 'voiceover'] as const) {
    for (const token of [
      '{{total.count}}',
      '{{总计}}',
      '{{!}}',
      '{{}}',
      '{{ total count }}',
      '{{obj.{total}}}',
      '{{total',
    ]) {
      const result = compile({ bindings, [field]: `核对 ${token}。` });
      assert.ok(!result.ok, `${field} unexpectedly published ${token}`);
      assert.match(result.reasons.join('\n'), new RegExp(`panels\\[0\\]\\.${field}: .*key`));
      assert.ok(!('actions' in result));
    }
  }
  const valid = compile({
    bindings,
    content: '结果为 {{ total }} 人。',
    formula: String.raw`8+4=\boxed{{{total}}}`,
    quoted_error: '学生的原始记号：{{total.count}}',
  });
  assert.ok(valid.ok);
  const board = valid.actions.find((action) => action.type === 'board');
  assert.equal(board?.formula, String.raw`8+4=\boxed{12}`);
  assert.match(board?.content ?? '', /结果为 12 人.*\{\{total\.count\}\}/s);
});

test('quotation remains visible without altering the board or opening redline', () => {
  const result = compile({
    quoted_error: '8+4=13',
    diagram: { diagram_kind: 'structure', description: '一张小图。' },
  });
  assert.ok(result.ok);
  assert.equal(result.illustration, undefined);
  const opening = compileTeacherTurn(openingContext, {
    ...scene(),
    panels: [{ title: '引用', content: '留给你判断。', quoted_error: '正确答案是 12。' }],
  });
  assert.ok(!opening.ok);
  assert.match(opening.reasons.join('\n'), /reveals the answer/);
});

test('bare arithmetic is audited in resolution, qualitative claims are left to the external judge', () => {
  for (const field of ['text', 'conclusion'] as const) {
    const result = compileTeacherTurn(verifiedContext, {
      ...masteredScene,
      resolution: { ...masteredScene.resolution, [field]: '7-6=2' },
    });
    assert.ok(!result.ok);
    assert.ok(result.reasons.some((reason) => reason.includes(`$.resolution.${field}`)));
  }
  // Numeric integrity does not infer meanings such as “tenfold” from prose.
  assert.ok(compile({ content: '从 90% 到 99%，灵敏度翻十倍。' }).ok);
});
