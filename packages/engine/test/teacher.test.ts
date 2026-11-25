import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from '@sinclair/typebox';
import { fauxAssistantMessage, fauxToolCall } from '../src/models.js';
import { createTeacherPlanner } from '../src/teacher.js';
import {
  answeredContext,
  openingContext as context,
  fauxResult,
  localFaux,
  masteredScene,
  scene,
} from './teacher-scene-fixture.js';

const fauxNativeCall = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });
function toolText(message: { content: readonly { type: string; text?: string }[] }) {
  return message.content.find(({ type }) => type === 'text')?.text ?? '';
}

function offeredToolNames(
  messages: readonly {
    role: string;
    toolsAdded?: readonly { name: string }[];
    toolsRemoved?: readonly { name: string }[];
  }[],
) {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'system') continue;
    for (const { name } of message.toolsRemoved ?? []) names.delete(name);
    for (const { name } of message.toolsAdded ?? []) names.add(name);
  }
  return [...names];
}

test('default planner runs real calc_verify through native pi-ai tool messages and traces its result', async () => {
  const { gateway, setResponses, state } = localFaux();
  setResponses([
    fauxNativeCall('calc_verify', { expression: '2/3 + 1/3', format: 'fraction' }),
    (request) => {
      const toolResult = request.messages.find((message) => message.role === 'toolResult');
      assert.ok(toolResult);
      assert.match(toolText(toolResult), /"text":"1"/);
      return fauxResult(scene());
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
  const { gateway, setResponses } = localFaux();
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
      return fauxResult(scene());
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
  const { gateway, setResponses } = localFaux();
  setResponses([
    fauxNativeCall('calc_verify', { expression: 'sqrt(-1)' }),
    (request) => {
      const observation = request.messages.find((message) => message.role === 'toolResult');
      assert.ok(observation);
      const result = toolText(observation);
      assert.match(result, /domain_error/);
      assert.equal(result.includes('stack'), false);
      return fauxResult(scene());
    },
  ]);

  const result = await createTeacherPlanner(gateway)(context, []);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result));
  const span = result.spans.find(({ kind }) => kind === 'tool');
  assert.ok(span);
  assert.equal(span.name, 'calc_verify');
  assert.match(JSON.stringify(span.result), /domain_error/);
});

test('two native tool steps reserve an emit-result-only request with both redacted observations', async () => {
  const { gateway, setResponses, state } = localFaux();
  const plan = createTeacherPlanner(gateway, [
    {
      name: 'mock_sum',
      description: 'a bounded calculation',
      parameters: Type.Object({ amount: Type.Number(), token: Type.String() }),
      run: () => ({ sum: 4, token: 'not-on-the-trace', note: 'also hidden' }),
    },
  ]);
  const call = fauxNativeCall('mock_sum', { amount: 2, token: 'fake-sensitive' });
  setResponses([
    call,
    (request) => {
      const history = JSON.stringify(request.messages);
      assert.match(history, /sum.{0,6}4/);
      assert.doesNotMatch(history, /not-on-the-trace|fake-sensitive/);
      return call;
    },
    (request) => {
      const messages = request.messages.filter((message) => message.role === 'toolResult');
      assert.equal(messages.length, 2);
      assert.deepEqual(offeredToolNames(request.messages), ['emit_result']);
      return fauxResult(scene());
    },
  ]);
  const accepted = await plan(context, []);
  assert.ok(accepted.ok);
  const spans = accepted.spans.filter(({ kind }) => kind === 'tool');
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0].input, { amount: 2 });
  assert.deepEqual(spans[0].result, { sum: 4, note: '[已隐藏]' });
  assert.equal(state.callCount, 3);
  assert.deepEqual(accepted.trace.guardrails, []);
});

test('an invalid submission gets bounded corrections but never another tool budget', async () => {
  const { gateway, setResponses, state } = localFaux();
  const call = fauxNativeCall('calc_verify', { expression: '2 + 3' });
  setResponses([
    call,
    call,
    fauxResult(masteredScene),
    (request) => {
      assert.deepEqual(offeredToolNames(request.messages), ['emit_result']);
      const prompt = JSON.stringify(request.messages);
      assert.match(prompt, /工具结果/);
      assert.doesNotMatch(prompt, /resolution|insert_keypoint|checkpoint/);
      return fauxResult(scene());
    },
  ]);
  const accepted = await createTeacherPlanner(gateway)(context, []);
  assert.ok(accepted.ok);
  assert.equal(accepted.trace.guardrails.length, 1);
  assert.equal(accepted.spans.filter(({ kind }) => kind === 'tool').length, 2);
  assert.equal(state.callCount, 4);

  const noisy = localFaux();
  const unknownTool = fauxNativeCall('unknown_tool', {});
  noisy.setResponses([unknownTool, unknownTool, call, call, call, fauxResult(scene())]);
  const rejected = await createTeacherPlanner(noisy.gateway)(context, []);
  assert.equal(rejected.ok, false);
  assert.deepEqual(
    rejected.trace.guardrails.map(({ attempt }) => attempt),
    [1, 2, 3],
  );
  assert.equal(rejected.spans.filter(({ kind }) => kind === 'tool').length, 0);
  assert.equal(noisy.state.callCount, 5);
});

test('faux student proceeds from a played ordinary question to a new transfer and then to mastery', async () => {
  const { gateway, setResponses } = localFaux();
  setResponses([
    fauxResult(masteredScene),
    fauxResult({
      ...scene('clarifying'),
      next_ask: { prompt: '九块可以分几对？', transfer: true },
    }),
    fauxResult(masteredScene),
  ]);
  const plan = createTeacherPlanner(gateway, []);
  const scaffold = await plan(answeredContext, []);
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
      ...answeredContext,
      played: [...answeredContext.played, ...scaffold.actions],
      input: { kind: 'answer', ask_step_id: verify.step_id, text: '四对，剩一块。' },
      progress: scaffold.progress,
    },
    [],
  );
  assert.ok(mastered.ok);
  assert.deepEqual(
    mastered.actions.slice(0, 2).map(({ type }) => type),
    ['speak', 'keypoint_complete'],
  );
});
