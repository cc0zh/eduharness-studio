import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTeacherTurn, type TeacherTurnOutput } from '../src/teacher.js';
import captures from './fixtures/teacher-numeric-live.json' with { type: 'json' };
import { answeredContext, scene } from './teacher-scene-fixture.js';

type Panel = TeacherTurnOutput['panels'][number];
const population = { key: 'healthy', expression: '10000-100' };
const repairs: Record<string, Partial<Panel>> = {
  'm25:4': {
    bindings: [population],
    content: '患病 100 人；健康人数 = {{healthy}}。',
    formula: String.raw`\text{健康人数}=10000-100={{healthy}}`,
    voiceover: '没有患病的是 {{healthy}} 人。',
  },
  'm25:26': {
    bindings: [population],
    content: '一万人只分两类：患病 100 人，健康 {{healthy}} 人。',
    formula: String.raw`\text{健康人数}=10000-10000\times 1\%={{healthy}}`,
    voiceover: '两组加起来正好是一万人。',
  },
  'm25:30': {
    bindings: [population],
    content: '患病 100 + 健康 {{healthy}} = 10000。',
    quoted_error: '患病 100 + 健康 9000 = 10000 ✘',
    voiceover: '两组合在一起，才是题目的一万人。',
  },
  'm25:41': {
    bindings: [population, { key: 'positive', expression: '90+891' }],
    content:
      '人数检查：100 + {{healthy}} = 10000。\n阳性中的概率之和：90/{{positive}} + 891/{{positive}} = 1。',
    formula: String.raw`P(\text{病}\mid+)=\frac{90}{ {{positive}} }\approx 9.17\%`,
  },
  'c2:31': {
    bindings: [
      { key: 'one', expression: '1' },
      { key: 'negative', expression: '-3' },
    ],
    content: 's→t 的直边权为 1。\ns→b→a→t 的边权依次是 {{one}}、{{negative}}、{{one}}。',
    formula: String.raw`\text{绕路总长}={{one}}+{{negative}}+{{one}}=?`,
  },
};

for (const { capture, boardSteps, panels, fault } of captures.failures) {
  test(`historical ${capture} boards ${boardSteps.join('/')} fail unchanged and accept a bound rewrite`, () => {
    const turn = { ...scene('clarifying'), panels };
    const rejected = compileTeacherTurn(answeredContext, turn);
    assert.ok(!rejected.ok);
    assert.ok(
      rejected.reasons.some((reason) => fault.every((part) => reason.includes(part))),
      rejected.reasons.join('\n'),
    );
    assert.ok(!('actions' in rejected));
    const repair = repairs[`${capture}:${boardSteps[0]}`];
    assert.ok(repair);
    const fixed = compileTeacherTurn(answeredContext, {
      ...turn,
      panels: [{ ...panels[0], ...repair }, ...panels.slice(1)],
    });
    assert.ok(fixed.ok, fixed.ok ? undefined : fixed.reasons.join('\n'));
    const actions = JSON.stringify(fixed.actions);
    assert.doesNotMatch(actions, /\{\{\w+\}\}|"bindings"|"quoted_error"/);
    if (repair.quoted_error) assert.ok(actions.includes(repair.quoted_error));
  });
}

for (const { capture, boardSteps, panels } of captures.cleanHistory) {
  test(`clean historical ${capture} boards ${boardSteps.join('/')} compile unchanged`, () => {
    const result = compileTeacherTurn(answeredContext, { ...scene('clarifying'), panels });
    assert.ok(result.ok, result.ok ? undefined : result.reasons.join('\n'));
    assert.deepEqual(
      result.actions
        .filter((action) => action.type === 'board')
        .map(({ content, formula }) => ({ content, formula })),
      panels.map(({ content, formula }: Panel) => ({ content, formula })),
    );
  });
}
