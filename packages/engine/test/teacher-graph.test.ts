import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GraphGenerator } from '../src/graph-generator.js';
import { createFauxModelGateway, fauxAssistantMessage, fauxToolCall } from '../src/models.js';
import type { TeacherTurnOutput } from '../src/teacher.js';
import { createTeacherPlanner } from '../src/teacher.js';
import type { TeacherTurnContext } from '../src/teacher-guardrails.js';

const copperplate =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" fill="#1A1917"><rect width="100" height="60" fill="#F6F3EC"/><path d="M10 50L50 10L90 50Z" fill="none" stroke="#A84428" stroke-width="2"/></svg>';
const expectedBoardwork = '三角形面积由底边和对应垂高共同决定。';
const context: TeacherTurnContext = {
  topic: '三角形面积',
  keypoints: [
    { id: 'area', title: '面积', objective: '理解面积', depth: 'intuition', status: 'active' },
    { id: 'base', title: '底边', objective: '选择底高', depth: 'application', status: 'pending' },
  ],
  state: 'intake',
  played: [],
  input: { kind: 'opening' },
  progress: { insertedCount: 0, lowEffortStreak: 0, highWater: 0, truncatedCardIds: [] },
  generation: 1,
  seed: 'graph-test',
};

const graphTurn: TeacherTurnOutput = {
  diagnosis: { status: 'opening', summary: '观察边界', strategy: '先定位几何关系' },
  actions: [
    {
      type: 'graph',
      column: 1,
      card_id: 'opening-graph',
      title: '底边与垂高',
      depth: 'intuition',
      content: expectedBoardwork,
      diagram_kind: 'geometry',
      description: '只标出底边与对应垂高，不填边长和面积结果。',
    },
    {
      type: 'highlight',
      card_id: 'opening-graph',
      target_text: '底边',
      style: 'circle',
    },
    { type: 'speak', text: '先找出底边，再看对面的顶点。' },
    { type: 'speak', text: '垂高要和底边配成一组。' },
    { type: 'ask', card_id: 'ask', mode: 'open', prompt: '顶点移动时，哪段长度不变？' },
  ],
};

function fauxOutput(value: TeacherTurnOutput) {
  return fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
}

test('materializes a validated graph as one playable, sanitized copperplate action', async () => {
  const faux = createFauxModelGateway();
  faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-test-key' });
  faux.setResponses([fauxOutput(graphTurn)]);
  let generatorRequest = '';
  const generator: GraphGenerator = {
    generate(request) {
      generatorRequest = `${request.title}: ${request.description}`;
      return copperplate;
    },
  };
  const result = await createTeacherPlanner(faux.gateway, [], { generator })(context, []);
  assert.ok(result.ok);
  if (!result.ok) return;
  const diagram = result.actions[0];
  assert.equal(diagram.type, 'graph');
  if (diagram.type === 'graph') {
    assert.equal(diagram.step_id, 1);
    assert.equal(diagram.card_id, 'opening-graph');
    assert.equal(diagram.svg_markup, copperplate);
    assert.equal(diagram.svg_markup.includes('diagram_kind'), false);
  }
  assert.equal(result.actions.length, graphTurn.actions.length);
  assert.ok(generatorRequest.includes('geometry'));
  const span = result.spans.find(({ name }) => name === 'graph_generator');
  assert.deepEqual(span?.result, { status: 'generated' });
});

test('unsafe SVG and timed-out drawing keep complete text boardwork and trace the fallback', async () => {
  for (const [generator, reason] of [
    [{ generate: () => copperplate.replace('#A84428', 'royalblue') }, 'unsafe_svg'],
    [{ generate: () => new Promise<string>(() => {}) }, 'timeout'],
  ] as const) {
    const faux = createFauxModelGateway();
    faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-test-key' });
    faux.setResponses([fauxOutput(graphTurn)]);
    const result = await createTeacherPlanner(faux.gateway, [], {
      generator: generator as GraphGenerator,
      timeoutMs: 10,
    })(context, []);
    assert.ok(result.ok);
    if (!result.ok) continue;
    assert.equal(result.actions[0].type, 'board');
    if (result.actions[0].type === 'board') {
      assert.equal(result.actions[0].content, expectedBoardwork);
      assert.equal(result.actions[0].card_id, 'opening-graph');
    }
    const span = result.spans.find(({ name }) => name === 'graph_generator');
    assert.deepEqual(span?.result, { status: 'fallback', reason });
  }
});

test('a rejected whole turn is retried before any drawing request can run', async () => {
  const faux = createFauxModelGateway();
  faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-test-key' });
  const rejected = {
    ...graphTurn,
    actions: [...graphTurn.actions, { type: 'keypoint_complete', keypoint_id: 'area' }],
  } as TeacherTurnOutput;
  faux.setResponses([
    fauxOutput(rejected),
    fauxOutput({
      ...graphTurn,
      actions: graphTurn.actions.map((action) => {
        if (action.type !== 'graph') return action;
        const { diagram_kind, description, ...board } = action;
        return { ...board, type: 'board' as const };
      }),
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
  if (result.ok) assert.equal(result.trace.guardrails.length, 1);
  assert.equal(drawingCalls, 0);
  assert.equal(faux.state.callCount, 2);
});
