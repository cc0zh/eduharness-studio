import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTeacherTurn } from '../src/teacher.js';
import { answeredContext, scene } from './teacher-scene-fixture.js';

type Calculation = { expression: string; exactText: string };

const arithmetic: readonly Calculation[] = [{ expression: '8 + 4', exactText: '12' }];

function turn(panel: Record<string, unknown>) {
  const base = scene('clarifying');
  return { ...base, panels: [{ ...base.panels[0], ...panel }] };
}

function compile(panel: Record<string, unknown>, calculations?: readonly Calculation[]) {
  return compileTeacherTurn(answeredContext, turn(panel), calculations);
}

function rejection(panel: Record<string, unknown>, calculations?: readonly Calculation[]) {
  const result = compile(panel, calculations);
  assert.equal(result.ok, false, `expected numeric rejection, got ${JSON.stringify(result)}`);
  return result.ok ? '' : result.reasons.join('\n');
}

function acceptance(panel: Record<string, unknown>, calculations?: readonly Calculation[]) {
  const result = compile(panel, calculations);
  assert.equal(result.ok, true, `expected numeric acceptance, got ${JSON.stringify(result)}`);
  return result;
}

function assertNumericConflict(
  reasons: string,
  field: 'content' | 'formula' | 'voiceover',
  correct: string,
  conflicting: string,
) {
  assert.ok(
    reasons
      .split('\n')
      .some(
        (reason) =>
          reason.includes('panels') && /(?:\[0\]|\/0)/.test(reason) && reason.includes(field),
      ),
    `expected a panels[0].${field} diagnostic path; got: ${reasons}`,
  );
  assert.ok(reasons.includes(correct), `expected correct value ${correct}; got: ${reasons}`);
  assert.ok(
    reasons.includes(conflicting),
    `expected conflicting value ${conflicting}; got: ${reasons}`,
  );
}

const equationFormats: readonly { name: string; render: (equation: string) => string }[] = [
  { name: 'plain', render: (equation) => equation },
  { name: 'inline TeX parentheses', render: (equation) => `\\(${equation}\\)` },
  { name: 'inline TeX dollars', render: (equation) => `$${equation}$` },
  { name: 'boxed equation', render: (equation) => `\\boxed{${equation}}` },
  { name: 'boxed result', render: (equation) => equation.replace(/=(\d+)$/, '=\\boxed{$1}') },
  { name: 'generic balanced wrapper', render: (equation) => `\\smash{${equation}}` },
  { name: 'single-argument layout macro', render: (equation) => `\\mathsf{${equation}}` },
  {
    name: 'nested layout macros',
    render: (equation) => `\\boxed{\\mathsf{${equation}}}`,
  },
  {
    name: 'nested multi-argument layout macros',
    render: (equation) => equation.replace(/=(\d+)$/, '=\\boxed{\\smash{\\textcolor{red}{$1}}}'),
  },
  {
    name: 'calculated endpoints separated by a symbol',
    render: (equation) => equation.replace('=', '=t='),
  },
  {
    name: 'aligned ampersand equals',
    render: (equation) => `\\begin{aligned}${equation.replace('=', '&=')}\\end{aligned}`,
  },
  {
    name: 'aligned line break and ampersand equals',
    render: (equation) => `\\begin{aligned}${equation.replace('=', '\\\\\n&=')}\\end{aligned}`,
  },
  { name: 'left text label', render: (equation) => `\\text{合计}=${equation}` },
  { name: 'completed result on next line', render: (equation) => equation.replace('=', '=\n') },
  { name: 'spaces around completed equality', render: (equation) => equation.replace('=', ' = ') },
  { name: 'trailing question mark', render: (equation) => `${equation}?` },
];

const fields = ['content', 'formula', 'voiceover'] as const;

function panelWithEquation(field: (typeof fields)[number], equation: string) {
  if (field === 'content') return { content: `核对：${equation}` };
  if (field === 'formula') return { formula: equation };
  return { voiceover: `因此，${equation}` };
}

for (const field of fields) {
  for (const format of equationFormats) {
    test(`numeric audit rejects and accepts metamorphic equations in ${field}: ${format.name}`, () => {
      const bad = format.render('8+4=13');
      const good = format.render('8+4=12');

      assertNumericConflict(rejection(panelWithEquation(field, bad)), field, '12', '13');
      acceptance(panelWithEquation(field, good));
    });
  }
}

test('an unresolved arithmetic question is not mistaken for a wrong numeric result', () => {
  for (const field of fields) {
    assert.ok(
      acceptance(panelWithEquation(field, '8+4=?')).ok,
      `${field} should remain a question`,
    );
  }
});

test('layout arguments are not math, and mathematical arguments are not discarded as layout', () => {
  const formula = (term: number) =>
    String.raw`8+4=\colorbox{#abcd}{\fcolorbox{red}{blue}{${term}}}`;
  assertNumericConflict(rejection({ formula: formula(13) }), 'formula', '12', '13');
  acceptance({ formula: formula(12) });
  acceptance({ formula: String.raw`5+5=\binom{5}{2}` });
  acceptance({ formula: String.raw`2+1=\frac{9}{3}` });
});

test('symbolic gaps do not hide tool conflicts or turn unrelated inequalities into equalities', () => {
  const formula = '12=a=13=b=8+4';
  const reasons = rejection({ formula }, arithmetic);
  assertNumericConflict(reasons, 'formula', '12', '13');
  assert.match(reasons, /calc_verify/);
  acceptance({ formula: '12=a=12=b=8+4' }, arithmetic);
  acceptance({ formula: '8+4=t' });
  acceptance({ formula: '8+4=x<13' });
  acceptance({ formula: '8+4=12 < 13=6+7' });
  assertNumericConflict(rejection({ formula: '8+4=13 < 16' }), 'formula', '12', '13');
  acceptance({ formula: '8+4=x²' });
});

const calculations: readonly Calculation[] = [{ expression: '10000 - 100', exactText: '9900' }];
test('agreeing bound formula and subtitle still reject drift in the third field', () => {
  const fields = {
    bindings: [{ key: 'healthy', expression: '10000-100' }],
    formula: String.raw`\text{健康人数}=10000-100={{healthy}},\quad \text{患病人数}=100`,
    voiceover: '健康人数为 {{healthy}} 人。健康人数为 {{healthy}} 人。',
  };
  const reasons = rejection({ ...fields, content: '健康人数为 9000 人。' }, calculations);
  assertNumericConflict(reasons, 'content', '9900', '9000');
  assert.match(reasons, /calc_verify/);
  acceptance({ ...fields, content: '健康人数为 9900 人。' }, calculations);

  const differentFormula = { ...fields, formula: String.raw`\text{健康人数}=9100` };
  const conflicting = rejection({ ...differentFormula, content: '健康人数为 9000 人。' });
  assertNumericConflict(conflicting, 'content', '9100', '9000');
});

test('thousands separators preserve a whole number, without consuming function commas', () => {
  for (const [lhs, correct, wrong] of [
    ['12,000 − 300', '11,700', '11,701'],
    ['12,000 − 300', '11700', '11800'],
    ['１２，０００ − ３００', '１１，７００', '１１，７０１'],
    [String.raw`\frac{12,000}{3}`, '4,000', '4,001'],
  ]) {
    for (const field of fields) {
      acceptance(panelWithEquation(field, `${lhs} = ${correct}`));
      const reasons = rejection(panelWithEquation(field, `${lhs} = ${wrong}`));
      assert.match(reasons, new RegExp(`\\$\\.panels\\[0\\]\\.${field}`));
    }
  }
  acceptance({ formula: 'max(12,300)=300' });
  assertNumericConflict(rejection({ formula: 'max(12,300)=12300' }), 'formula', '300', '12300');
  acceptance({ formula: String.raw`C(5,2)=10,\quad 7+2=9` });
  acceptance({ content: '核对：12,000 − 300 = 11,700,确实没错。' });
});

const resultFormats = [...equationFormats, { name: 'bare calculation', render: () => '10000-100' }];
for (const field of ['content', 'voiceover'] as const) {
  for (const { name, render } of resultFormats) {
    test(`same calculation, correct formula and drifting ${field}: ${name}`, () => {
      const formula = render('10000-100=9900');
      const reasons = rejection({ formula, [field]: '计算结果为 9000 人。' }, calculations);
      assertNumericConflict(reasons, field, '9900', '9000');
      assert.match(reasons, /calc_verify/);
      acceptance({ formula, [field]: '计算结果为 9900 人。' }, calculations);
    });
  }
}

const pathProse = 's→a→t 的边权依次为 −3、−1。';
for (const label of ['', String.raw`\text{绕路总长}=`]) {
  for (const wrapper of [(body: string) => body, (body: string) => `\\boxed{${body}}`]) {
    for (const complete of [false, true]) {
      test(`same path edges versus a different sum: ${label || 'plain'}, ${wrapper('…')}, completed=${complete}`, () => {
        const equation = (sum: string, value: string) =>
          wrapper(`${label}${sum}=${complete ? value : '?'}`);
        const wrong = rejection({ content: pathProse, formula: equation('1+(-3)+1', '-1') });
        assertNumericConflict(wrong, 'formula', '[-3, -1]', '1+(-3)+1');
        acceptance({ content: pathProse, formula: equation('(-3)+(-1)', '-4') });
      });
    }
  }
}

test('different reported edge weights on the same route are rejected even if the totals match', () => {
  const content = 's→a→t 的边权依次是 1、5。';
  const formula = String.raw`\text{路径长度}=1+5=6`;
  const wrong = rejection({ content, formula, voiceover: 's→a→t 的边权依次是 2、4。' });
  assertNumericConflict(wrong, 'voiceover', '[1, 5]', '[2, 4]');
  acceptance({ content, formula, voiceover: content });
});

test('an implausible square-root result is rejected but a reasonable approximation is accepted', () => {
  const wrong = rejection({ formula: 'sqrt(2) = 99' });
  assertNumericConflict(wrong, 'formula', '1.414', '99');
  acceptance({ formula: 'sqrt(2) = 1.4142' });
  assert.ok(acceptance({ formula: 'sqrt(2) ≈ 1.4142' }).ok);
});

const quotedErrors = [
  '学生误算成：\n8+4=13',
  '### 学生误算成\n> ✘ 8+4=13',
  '| 学生误算 | 结果 |\n| --- | ---: |\n| 8+4 | 13 |',
  '✘ 8+4=13',
];

for (const quote of quotedErrors) {
  test(`quoted_error is preserved verbatim but excluded from numeric audit: ${quote.slice(0, 18)}`, () => {
    const result = acceptance(
      {
        content: '正确推导：8+4=12',
        formula: '8+4=12',
        voiceover: '总数是 12。',
        quoted_error: quote,
      },
      arithmetic,
    );
    assert.ok(result.ok);
    const board = result.actions.find((action) => action.type === 'board');
    assert.ok(board?.type === 'board');
    assert.ok(board.content.includes(quote), `board must retain the original quote: ${quote}`);
    const wrong = rejection({ content: '| 教师推导 |\n| --- |\n| 8+4=14 |', quoted_error: quote });
    assertNumericConflict(wrong, 'content', '12', '14');
  });
}

test('quoted wrong work cannot exempt an incorrect teacher derivation in another field', () => {
  const reasons = rejection(
    {
      content: '正确计算应为 12。',
      formula: '8+4=13',
      quoted_error: '学生误算成：\n8+4=13',
    },
    arithmetic,
  );
  assertNumericConflict(reasons, 'formula', '12', '13');
});

test('parenthesized teacher work remains audited independently of quoted_error', () => {
  const quoted_error = '| 学生错算 |\n| --- |\n| 8+4=13 |';
  for (const render of [
    (rhs: number) => `教师的验算（8+4=${rhs}）。`,
    (rhs: number) => `教师的验算 (8+4=${rhs})。`,
    (rhs: number) => `代入（(6+2)+4=${rhs}），再对照。`,
    (rhs: number) => `验算：8+4=${rhs}（人）。`,
    (rhs: number) => `两步验算（8+4=${rhs}，另算 7+2=9）。`,
  ]) {
    assertNumericConflict(rejection({ content: render(14), quoted_error }), 'content', '12', '14');
    acceptance({ content: render(12), quoted_error });
  }
  acceptance({ content: '式子里的 (8+4)×2=24；x(8+4)=15。', quoted_error });
});
