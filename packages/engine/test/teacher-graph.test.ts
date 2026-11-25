import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GraphGenerator } from '../src/graph-generator.js';
import type { TeacherTurnOutput } from '../src/teacher.js';
import { createTeacherPlanner } from '../src/teacher.js';
import { openingContext as context, fauxResult, localFaux } from './teacher-scene-fixture.js';

const copperplate =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" fill="#1A1917"><rect width="100" height="60" fill="#F6F3EC"/><path d="M10 50L50 10L90 50Z" fill="none" stroke="#A84428" stroke-width="2"/></svg>';
const expectedBoardwork = '三角形面积由底边和对应垂高共同决定。';
const graphTurn: TeacherTurnOutput = {
  diagnosis: { status: 'opening', summary: '观察边界', strategy: '先定位几何关系' },
  panels: [
    {
      title: '底边与垂高',
      content: expectedBoardwork,
      highlight: '不存在的短语',
      voiceover: '先找出底边，再看对面的顶点。',
      diagram: {
        diagram_kind: 'geometry',
        description: '只标出底边与对应垂高，不填边长和面积结果。',
      },
    },
  ],
  next_ask: { prompt: '顶点移动时，哪段长度不变？' },
};

test('materializes a validated graph as one playable, sanitized copperplate action', async () => {
  const faux = localFaux();
  faux.setResponses([
    fauxResult({ ...graphTurn, panels: [{ title: '情境', content: '看图' }, ...graphTurn.panels] }),
  ]);
  let generatorRequest = '';
  const generator: GraphGenerator = {
    generate(request) {
      generatorRequest = `${request.title}: ${request.description}`;
      return copperplate;
    },
  };
  const result = await createTeacherPlanner(faux.gateway, [], { generator })(context, []);
  assert.ok(result.ok);
  const [, diagram] = result.actions;
  assert.ok(diagram.type === 'graph');
  assert.equal(diagram.step_id, 2);
  assert.equal(diagram.column, 2);
  assert.equal(diagram.svg_markup, copperplate);
  assert.deepEqual(
    result.actions.map(({ type }) => type),
    ['board', 'graph', 'speak', 'ask'],
  );
  assert.ok(generatorRequest.includes('geometry'));
  const span = result.spans.find(({ name }) => name === 'graph_generator');
  assert.deepEqual(span?.result, { status: 'generated' });
  assert.equal(span?.step_id, diagram.step_id);
});

test('unsafe SVG and timed-out drawing keep complete text boardwork and trace the fallback', async () => {
  for (const [generator, reason] of [
    [{ generate: () => copperplate.replace('#A84428', 'royalblue') }, 'unsafe_svg'],
    [{ generate: () => new Promise<string>(() => {}) }, 'timeout'],
    [
      {
        generate: () =>
          copperplate.replace('</svg>', '<text x="10" y="30">正确答案是 B</text></svg>'),
      },
      'opening_reveal',
    ],
  ] as const) {
    const faux = localFaux();
    faux.setResponses([fauxResult(graphTurn)]);
    const result = await createTeacherPlanner(faux.gateway, [], {
      generator: generator as GraphGenerator,
      timeoutMs: 10,
    })(context, []);
    assert.ok(result.ok);
    const [board] = result.actions;
    assert.ok(board.type === 'board');
    assert.equal(board.content, expectedBoardwork);
    assert.deepEqual(
      result.actions.map(({ type }) => type),
      ['board', 'speak', 'ask'],
    );
    const span = result.spans.find(({ name }) => name === 'graph_generator');
    assert.deepEqual(span?.result, { status: 'fallback', reason });
  }
});

test('a rejected whole turn is retried before any drawing request can run', async () => {
  const faux = localFaux();
  const rejected = {
    ...graphTurn,
    panels: [{ ...graphTurn.panels[0], voiceover: '正确答案是第二个。' }],
  };
  const { diagram, ...boardPanel } = graphTurn.panels[0];
  faux.setResponses([
    fauxResult(rejected),
    fauxResult({
      ...graphTurn,
      panels: [boardPanel],
    }),
  ]);
  let drawingCalls = 0;
  const plan = createTeacherPlanner(faux.gateway, [], {
    generator: {
      generate: () => {
        drawingCalls += 1;
        return copperplate;
      },
    },
  });
  const result = await plan(context, []);
  assert.ok(result.ok);
  assert.equal(result.trace.guardrails.length, 1);
  assert.equal(drawingCalls, 0);
  assert.equal(faux.state.callCount, 2);
});

test('an exact mark takes precedence over a diagram so the played action is visibly highlightable', async () => {
  const faux = localFaux();
  faux.setResponses([
    fauxResult({ ...graphTurn, panels: [{ ...graphTurn.panels[0], highlight: '底边' }] }),
  ]);
  let illustrations = 0;
  const planned = await createTeacherPlanner(faux.gateway, [], {
    generator: {
      generate: () => {
        illustrations++;
        return copperplate;
      },
    },
  })(context, []);
  assert.ok(planned.ok);
  const [board, mark] = planned.actions;
  assert.ok(board.type === 'board' && mark.type === 'highlight');
  assert.equal(mark.card_id, board.card_id);
  assert.ok(board.content.includes(mark.target_text));
  assert.equal(illustrations, 0);
});
