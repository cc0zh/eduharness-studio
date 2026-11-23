import assert from 'node:assert/strict';
import test from 'node:test';
import {
  demoCourses,
  GraphActionSchema,
  offlineLesson,
  sanitizeSvg,
  validateActions,
  validateLessonScript,
} from '../src/index.js';
import { compileLesson } from '../src/lesson-playback.js';

const validSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 10"><rect x="0" y="0" width="12" height="10" fill="#fff"/></svg>';

test('SVG whitelist accepts bounded static vector artwork', () => {
  assert.equal(sanitizeSvg(validSvg), validSvg);
  for (const course of demoCourses) {
    const script = offlineLesson(course, course.units[0].lessons[0]);
    assert.ok(
      script.actions
        .filter(({ type }) => type === 'graph')
        .every((action) => action.type === 'graph' && sanitizeSvg(action.svg_markup)),
      course.title,
    );
  }
});

test('SVG whitelist rejects active content, links, embedded CSS and broken XML', () => {
  const malicious = [
    validSvg.replace('</svg>', '<script>alert(1)</script></svg>'),
    validSvg.replace('</svg>', '<foreignObject><div>unsafe</div></foreignObject></svg>'),
    validSvg.replace('<rect ', '<rect onload="alert(1)" '),
    validSvg.replace('<rect ', '<rect href="https://attacker.invalid/image.svg" '),
    validSvg.replace('<rect ', '<rect xlink:href="#attacker" '),
    validSvg.replace('<svg ', '<svg viewBox="0 0 12 10" '),
    validSvg.replace('viewBox="0 0 12 10"', 'viewBox="0 0 -1 10"'),
    validSvg.replace('fill="#fff"', 'fill="url(https://attacker.invalid/#paint)"'),
    validSvg.replace('<svg ', '<svg style="background:url(javascript:alert(1))" '),
    `<!DOCTYPE svg [<!ENTITY x "boom">]>${validSvg}`,
    validSvg.replace('</svg>', '<g><rect x="1"/></svg>'),
    `${validSvg}${validSvg}`,
  ];
  for (const svg of malicious) {
    assert.equal(sanitizeSvg(svg), undefined, svg);
    assert.equal(
      validateActions([
        { type: 'graph', step_id: 1, column: 1, card_id: 'evil', title: 'bad', svg_markup: svg },
      ]).ok,
      false,
    );
  }

  const oversized = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>${'x'.repeat(32_001)}</text></svg>`;
  assert.equal(sanitizeSvg(oversized), undefined);
});

test('graph accepts old scripts without optional diagram and validates structured diagrams', () => {
  const original = demoCourses[0];
  const graph = offlineLesson(original, original.units[0].lessons[0]).actions.find(
    ({ type }) => type === 'graph',
  );
  assert.ok(graph && graph.type === 'graph');
  assert.equal('diagram' in graph, false);
  assert.equal(validateActions([graph]).ok, true);
  assert.equal(
    validateActions([{ ...graph, diagram: { nodes: [{ id: 'Q', label: 'query' }], edges: [] } }])
      .ok,
    true,
  );
  assert.equal(validateActions([{ ...graph, diagram: { nodes: [], edges: [] } }]).ok, false);
  assert.equal(
    validateActions([
      { ...graph, diagram: { nodes: [{ id: 'Q', label: 'query', script: true }], edges: [] } },
    ]).ok,
    false,
  );
  assert.equal(GraphActionSchema.type, 'object');
});

test('stored lessons and new fixture authoring both reject a fourth column', () => {
  const course = demoCourses[0];
  const source = offlineLesson(course, course.units[0].lessons[0]);
  const legacy = {
    ...source,
    actions: source.actions.map((action) =>
      action.type === 'board' ? { ...action, column: 4 } : action,
    ),
  };
  assert.equal(validateLessonScript(legacy), false);
  assert.equal(validateActions(legacy.actions).ok, false);

  const wideBoard = {
    type: 'board' as const,
    step_id: 1,
    column: 4,
    card_id: 'new-wide-card',
    content: '新编写的剧本不能声明第4栏。',
  };
  assert.equal(validateActions([wideBoard]).ok, false);

  assert.throws(
    () =>
      compileLesson([
        {
          id: 'too-wide',
          title: '超宽板书',
          objective: '使用新增单栏限制。',
          depth: 'application',
          verification: '核对分栏。',
          beats: [
            {
              type: 'board',
              column: 4,
              card_id: 'column-four',
              content: '不进入新教学剧本。',
            },
          ],
        },
        {
          id: 'filler',
          title: '后续要点',
          objective: '满足脚本的最小要点数。',
          depth: 'application',
          verification: '核对结果。',
          beats: [{ type: 'speak', text: '续讲。' }],
        },
      ]),
    /Invalid offline lesson script/,
  );
});

test('stored lesson reads reject graph markup outside the shared SVG whitelist', () => {
  const course = demoCourses[0];
  const source = offlineLesson(course, course.units[0].lessons[0]);
  const corrupted = {
    ...source,
    actions: source.actions.map((action) =>
      action.type === 'graph'
        ? { ...action, svg_markup: validSvg.replace('<rect ', '<rect onload="alert(1)" ') }
        : action,
    ),
  };
  assert.equal(validateLessonScript(corrupted), false);
});
