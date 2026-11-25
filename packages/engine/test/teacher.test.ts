import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KindGuard, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { projectKeypointProgress } from '../src/lesson-playback.js';
import { createFauxModelGateway, fauxAssistantMessage, fauxToolCall } from '../src/models.js';
import type { Action } from '../src/protocol.js';
import {
  createTeacherPlanner,
  type TeacherTurnContext,
  type TeacherTurnOutput,
  TeacherTurnOutputSchema,
} from '../src/teacher.js';
import { guardTeacherTurn, shuffleAskOptions } from '../src/teacher-guardrails.js';

const context: TeacherTurnContext = {
  topic: '奇偶性',
  input: { kind: 'opening' },
  keypoints: [
    { id: 'pairs', title: '配对', objective: '理解配对', depth: 'intuition', status: 'active' },
    { id: 'sum', title: '和', objective: '应用奇偶性', depth: 'application', status: 'pending' },
  ],
  state: 'intake',
  played: [],
  progress: { insertedCount: 0, lowEffortStreak: 0, highWater: 0, truncatedCardIds: [] },
  generation: 1,
  seed: 'test',
};

const options = [
  { id: 'paired', label: '恰好成对' },
  { id: 'odd', label: '剩下一个' },
];
const drafts: TeacherTurnOutput['actions'] = [
  { type: 'board', column: 1, card_id: 'c1', content: '让积木两两站在一起。' },
  { type: 'highlight', card_id: 'c1', target_text: '两两', style: 'circle' },
  { type: 'speak', text: '想象在桌面上摆出五块积木。' },
  { type: 'ask', card_id: 'q1', mode: 'choice', prompt: '桌上会有什么？', options },
];

function output(
  status: TeacherTurnOutput['diagnosis']['status'],
  actions = drafts,
): TeacherTurnOutput {
  return { diagnosis: { status, summary: '观察配对', strategy: '换例子推断' }, actions };
}

const transferAsk: Action = {
  type: 'ask',
  mode: 'open',
  checkpoint: 'verify',
  step_id: 10,
  card_id: 'q0',
  prompt: '换成七块如何配对？',
};
const answered: TeacherTurnContext = {
  ...context,
  state: 'handoff',
  played: [transferAsk],
  input: { kind: 'answer', ask_step_id: 10, text: '三对，剩一块。' },
  progress: { ...context.progress, highWater: 10 },
};

const completion: TeacherTurnOutput['actions'] = [
  { type: 'speak', checkpoint: 'verify', text: '三对后确实剩一块，所以七是奇数。' },
  { type: 'keypoint_complete', keypoint_id: 'pairs' },
  { type: 'board', column: 2, card_id: 'next', content: '把两个数的积木并排放。' },
  { type: 'ask', card_id: 'next-ask', mode: 'open', prompt: '两堆拼在一起会怎样？' },
];

function rejection(result: ReturnType<typeof guardTeacherTurn>, regex: RegExp) {
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reasons.join('\n'), regex);
}

test('teacher draft schema bounds beats and rejects model-owned IDs and options on open asks', () => {
  const good = output('opening');
  assert.ok(Value.Check(TeacherTurnOutputSchema, good));
  assert.equal(Value.Check(TeacherTurnOutputSchema, { ...good, actions: drafts.slice(1) }), false);
  assert.equal(
    Value.Check(TeacherTurnOutputSchema, { ...good, actions: [...drafts, ...drafts, drafts[0]] }),
    false,
  );
  assert.equal(
    Value.Check(TeacherTurnOutputSchema, {
      ...good,
      actions: [{ ...drafts[0], step_id: 1 }, ...drafts.slice(1)],
    }),
    false,
  );
  assert.equal(
    Value.Check(TeacherTurnOutputSchema, {
      ...good,
      actions: [...drafts.slice(0, -1), { ...drafts.at(-1), mode: 'open' }],
    }),
    false,
  );
});

test('opening protects handoff, layout and acknowledged board references', () => {
  const highWater = {
    ...context,
    progress: { ...context.progress, highWater: 19, truncatedCardIds: ['discarded'] },
  };
  const planned = guardTeacherTurn(highWater, output('opening'));
  assert.ok(planned.ok);
  assert.deepEqual(
    planned.actions.map(({ step_id }) => step_id),
    [20, 21, 22, 23],
  );
  rejection(
    guardTeacherTurn(
      highWater,
      output('opening', [
        { type: 'board', column: 1, card_id: 'discarded', content: 'x'.repeat(181) },
        { type: 'highlight', card_id: 'ghost', target_text: 'ghost', style: 'circle' },
        { type: 'speak', text: '正确答案是第二个。' },
        { type: 'speak', text: '最终结果是 31%。' },
        { type: 'speak', text: 'x'.repeat(141) },
      ]),
    ),
    /truncated beat[\s\S]*acknowledged[\s\S]*reveals[\s\S]*reveals[\s\S]*140[\s\S]*end at ask/,
  );
  const medicalSetup = guardTeacherTurn(
    highWater,
    output('opening', [
      {
        type: 'board',
        column: 1,
        card_id: 's20-b1',
        content: '某次筛查检测结果是阳性，复查化验结果为阳性，样本结果：待核对。',
      },
      { type: 'speak', text: '检测结果是阳性时，患病概率一定很高吗？' },
      { type: 'speak', text: '先结合人群患病率想一想。' },
      { type: 'ask', card_id: 's20-q1', mode: 'open', prompt: '你会先查哪个数？' },
    ]),
  );
  assert.ok(medicalSetup.ok);
  assert.deepEqual(shuffleAskOptions(options, 'repeat'), shuffleAskOptions(options, 'repeat'));
  assert.equal(
    new Set(Array.from({ length: 8 }, (_, i) => shuffleAskOptions(options, `${i}`)[0].id)).size,
    2,
  );
});

test('mastery needs a played transfer ask, current answer, spoken check and active keypoint', () => {
  assert.ok(guardTeacherTurn(answered, output('mastered', completion)).ok);
  for (const text of ['我不知道。', '我拿不准，给点提示。', "I don't know."]) {
    const unsure = { ...answered, input: { kind: 'answer' as const, ask_step_id: 10, text } };
    rejection(guardTeacherTurn(unsure, output('mastered', completion)), /substantive answer/);
    assert.ok(guardTeacherTurn(unsure, output('clarifying')).ok);
  }
  assert.ok(
    guardTeacherTurn(
      { ...answered, input: { kind: 'answer', ask_step_id: 10, text: '3' } },
      output('mastered', completion),
    ).ok,
  );
  rejection(guardTeacherTurn(answered, output('misconception', completion)), /requires mastered/);
  rejection(
    guardTeacherTurn(
      { ...answered, played: [{ ...transferAsk, checkpoint: undefined }] },
      output('mastered', completion),
    ),
    /acknowledged verify ask/,
  );
  rejection(
    guardTeacherTurn(
      { ...answered, input: { kind: 'interrupt', text: '我懂了' } },
      output('mastered', completion),
    ),
    /substantive answer/,
  );
  rejection(
    guardTeacherTurn(
      answered,
      output('mastered', [{ type: 'speak', text: '好。' }, ...completion.slice(1)]),
    ),
    /immediately before completion/,
  );
});

test('prerequisites go before the active point and are bounded by both caps', () => {
  const patch = {
    ...output('missing_prereq'),
    insert_keypoint: {
      id: 'groups',
      title: '会分组',
      objective: '两块一组',
      depth: 'intuition' as const,
    },
  };
  const result = guardTeacherTurn(answered, patch);
  assert.ok(result.ok);
  assert.deepEqual(
    result.keypoints.map(({ id, status }) => [id, status]),
    [
      ['groups', 'active'],
      ['pairs', 'pending'],
      ['sum', 'pending'],
    ],
  );
  assert.deepEqual(result.trace.inserted, { id: 'groups', title: '会分组', before: 'pairs' });
  rejection(
    guardTeacherTurn({ ...answered, progress: { ...answered.progress, insertedCount: 2 } }, patch),
    /at most two/,
  );
  const six = [
    ...context.keypoints,
    ...[1, 2, 3, 4].map((i) => ({ ...context.keypoints[1], id: `extra-${i}` })),
  ];
  rejection(guardTeacherTurn({ ...answered, keypoints: six }, patch), /six total/);
  rejection(
    guardTeacherTurn(answered, { ...patch, diagnosis: output('clarifying').diagnosis }),
    /insert_keypoint/,
  );
});

test('bare replies require first a two-choice scaffold, then honest unverified progress', () => {
  const low: TeacherTurnContext = {
    ...answered,
    input: { kind: 'answer', ask_step_id: 10, text: '１！' },
  };
  rejection(guardTeacherTurn(low, output('mastered', completion)), /low_effort/);
  const first = guardTeacherTurn(low, output('low_effort'));
  assert.ok(first.ok);
  assert.equal(first.progress.lowEffortStreak, 1);
  assert.equal(first.actions.at(-1)?.type, 'ask');
  const again = { ...low, progress: first.progress };
  rejection(guardTeacherTurn(again, output('low_effort')), /advance .*keypoint_unverified/);
  const advance = output('low_effort', [
    drafts[0],
    { type: 'keypoint_unverified', keypoint_id: 'pairs' },
    ...drafts.slice(2),
  ]);
  const second = guardTeacherTurn(again, advance);
  assert.ok(second.ok);
  assert.equal(second.trace.unverified, 'pairs');
  assert.equal(
    second.progress.lowEffortStreak,
    2,
    'keep the second low-effort attempt pending until its outcome is played',
  );
  assert.deepEqual(
    projectKeypointProgress(context.keypoints, second.actions).keypoints.map(
      ({ status }) => status,
    ),
    ['unverified', 'active'],
  );
  const skip = { ...low, input: { kind: 'interrupt' as const, text: '请跳过这题' } };
  assert.ok(guardTeacherTurn(skip, advance).ok);
  const selectedSkip = {
    ...low,
    input: { kind: 'answer' as const, ask_step_id: 10, option_id: 'skip', text: '跳过这题' },
  };
  const selectedSkipTurn = output('low_effort', [
    drafts[0],
    { type: 'keypoint_unverified', keypoint_id: 'pairs' },
    { type: 'speak', text: '先保留这条配对线索。' },
    drafts[3],
  ]);
  const selectedSkipResult = guardTeacherTurn(selectedSkip, selectedSkipTurn);
  assert.ok(
    selectedSkipResult.ok,
    selectedSkipResult.ok ? undefined : selectedSkipResult.reasons.join('\n'),
  );
});

const fauxResult = (value: Parameters<typeof fauxToolCall>[1][string]) =>
  fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
const fauxNativeCall = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });
function toolText(message: { content: readonly { type: string; text?: string }[] }) {
  return message.content.find(({ type }) => type === 'text')?.text ?? '';
}

test('default planner runs real calc_verify through native pi-ai tool messages and traces its result', async () => {
  const { gateway, setResponses, state } = createFauxModelGateway();
  gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-test-key' });
  setResponses([
    fauxNativeCall('calc_verify', { expression: '2/3 + 1/3', format: 'fraction' }),
    (request) => {
      const toolResult = request.messages.find((message) => message.role === 'toolResult');
      assert.ok(toolResult);
      assert.match(toolText(toolResult), /"text":"1"/);
      return fauxResult(output('opening'));
    },
  ]);

  const result = await createTeacherPlanner(gateway)(context, []);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result));
  assert.equal(state.callCount, 2);
  const span = result.spans.find(({ kind }) => kind === 'tool');
  assert.ok(span);
  assert.equal(span.name, 'calc_verify');
  assert.deepEqual(span.input, { expression: '2/3 + 1/3', format: 'fraction' });
  assert.deepEqual(span.result, { ok: true, value: 1, text: '1', approximate: false });
});

test('calc_verify returns approximate and over-limit results safely to the model and X-Ray', async () => {
  const { gateway, setResponses } = createFauxModelGateway();
  gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-test-key' });
  setResponses([
    fauxNativeCall('calc_verify', { expression: 'sqrt(2)' }),
    (request) => {
      const result = request.messages.find((message) => message.role === 'toolResult');
      assert.ok(result);
      assert.match(toolText(result), /"approximate":true/);
      return fauxNativeCall('calc_verify', { expression: '1'.repeat(513) });
    },
    (request) => {
      const results = request.messages.filter((message) => message.role === 'toolResult');
      assert.equal(results.length, 2);
      assert.match(toolText(results[1]), /did not match the calc_verify schema/);
      return fauxResult(output('opening'));
    },
  ]);

  const result = await createTeacherPlanner(gateway)(context, []);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result));
  const spans = result.spans.filter(({ kind }) => kind === 'tool');
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0].result, {
    ok: true,
    value: Number(Math.sqrt(2).toPrecision(15)),
    text: String(Number(Math.sqrt(2).toPrecision(15))),
    approximate: true,
  });
  assert.deepEqual(spans[1].input, { expression: '[已隐藏]', length: 513, format: 'decimal' });
  assert.deepEqual(spans[1].result, {
    ok: false,
    error: {
      code: 'invalid_input',
      message: 'Arguments exceeded the bounded calc_verify schema.',
    },
  });
});

test('calc_verify domain errors are returned as bounded observations instead of aborting a teacher turn', async () => {
  const { gateway, setResponses } = createFauxModelGateway();
  gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-test-key' });
  setResponses([
    fauxNativeCall('calc_verify', { expression: 'sqrt(-1)' }),
    (request) => {
      const observation = request.messages.find((message) => message.role === 'toolResult');
      assert.ok(observation);
      const result = toolText(observation);
      assert.match(result, /domain_error/);
      assert.equal(result.includes('stack'), false);
      return fauxResult(output('opening'));
    },
  ]);

  const result = await createTeacherPlanner(gateway)(context, []);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result));
  const span = result.spans.find(({ kind }) => kind === 'tool');
  assert.ok(span);
  assert.equal(span.name, 'calc_verify');
  assert.match(JSON.stringify(span.result), /domain_error/);
});

test('faux planner caps tools, redacts their spans and supplies concrete correction feedback', async () => {
  const { gateway, setResponses, state } = createFauxModelGateway();
  assert.ok(gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-test-key' }));
  const plan = createTeacherPlanner(gateway, [
    {
      name: 'mock_sum',
      description: 'mock a bounded calculation',
      parameters: Type.Object({ amount: Type.Number(), token: Type.String() }),
      run: () => ({ sum: 4, token: 'not-on-the-trace', note: 'also hidden' }),
    },
  ]);
  const call = fauxNativeCall('mock_sum', { amount: 2, token: 'fake-sensitive' });
  setResponses([
    call,
    (request) => {
      const prompt = JSON.stringify(request.messages);
      assert.match(prompt, /sum.{0,6}4/);
      assert.equal(prompt.includes('not-on-the-trace'), false);
      assert.equal(prompt.includes('fake-sensitive'), false);
      return call;
    },
    fauxResult(output('mastered', completion)),
    (request) => {
      const prompt = JSON.stringify(request.messages);
      assert.match(prompt, /opening schema forbids insert_keypoint/);
      assert.match(prompt, /invalid structured output/);
      assert.match(prompt, /mock_sum/);
      return fauxResult(output('opening'));
    },
  ]);
  const accepted = await plan(context, []);
  assert.ok(accepted.ok, !accepted.ok ? JSON.stringify(accepted) : undefined);
  assert.equal(accepted.trace.guardrails.length, 1);
  const tools = accepted.spans.filter(({ kind }) => kind === 'tool');
  assert.equal(tools.length, 2);
  assert.deepEqual(tools[0].input, { amount: 2 });
  assert.deepEqual(tools[0].result, { sum: 4, note: '[已隐藏]' });
  assert.equal(state.callCount, 4);
  setResponses([call, call, call, call, call, fauxResult(output('opening'))]);
  const rejected = await plan(context, []);
  assert.equal(rejected.ok, false);
  assert.deepEqual(
    rejected.trace.guardrails.map(({ attempt }) => attempt),
    [1, 2, 3],
  );
  assert.equal(rejected.spans.filter(({ kind }) => kind === 'tool').length, 2);
});

test('provider cannot emit mastery actions before an acknowledged transfer answer', async () => {
  const { gateway, setResponses } = createFauxModelGateway();
  gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-only' });
  const ordinaryAsk = { ...transferAsk, checkpoint: undefined };
  const target = output('clarifying', [
    ...drafts.slice(0, 3),
    {
      type: 'ask',
      mode: 'open',
      card_id: 'q-verify',
      prompt: '九块可以分几对？',
      checkpoint: 'verify',
    },
  ]);
  const premature = output('mastered', completion);
  let prematureAdvertised: boolean | undefined;
  setResponses([
    ({ messages }) => {
      const declaration = messages
        .flatMap((message) => (message.role === 'system' ? (message.toolsAdded ?? []) : []))
        .find(({ name }) => name === 'emit_result');
      assert.ok(declaration && KindGuard.IsSchema(declaration.parameters));
      prematureAdvertised = Value.Check(declaration.parameters, { value: premature });
      return fauxResult(premature);
    },
    fauxResult(target),
    fauxResult(premature),
  ]);
  const plan = createTeacherPlanner(gateway);
  const scaffold = await plan({ ...answered, played: [ordinaryAsk] }, []);
  assert.equal(prematureAdvertised, false);
  assert.ok(scaffold.ok);
  assert.equal(scaffold.trace.guardrails.length, 1);
  assert.equal(
    scaffold.actions.some(({ type }) => type === 'keypoint_complete'),
    false,
  );
  const verify = scaffold.actions.at(-1);
  assert.ok(verify?.type === 'ask' && verify.checkpoint === 'verify');
  const mastered = await plan(
    {
      ...answered,
      played: [ordinaryAsk, ...scaffold.actions],
      input: { kind: 'answer', ask_step_id: verify.step_id, text: '四对，剩一块。' },
      progress: scaffold.progress,
    },
    [],
  );
  assert.ok(mastered.ok);
  assert.equal(mastered.actions[0].type, 'speak');
  assert.equal(mastered.actions[1].type, 'keypoint_complete');

  setResponses([fauxResult(premature), fauxResult(output('clarifying'))]);
  const unsure = await plan(
    {
      ...answered,
      input: { kind: 'answer', ask_step_id: 10, text: '不知道。' },
    },
    [],
  );
  assert.ok(unsure.ok);
  assert.equal(unsure.trace.guardrails.length, 1);
  assert.match(unsure.trace.guardrails[0].reasons.join('\n'), /omit keypoint_complete/);
  assert.equal(
    unsure.actions.some(({ type }) => type === 'keypoint_complete'),
    false,
  );
});
