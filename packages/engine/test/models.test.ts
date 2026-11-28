import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from '@sinclair/typebox';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
  ModelGenerationError,
} from '../src/models.js';

const schema = Type.Object({ count: Type.Integer() }, { additionalProperties: false });
const request = { prompt: 'Count the examples.', schema };
const key = 'faux-engine-credential';
const byok = { provider: 'faux', modelId: 'faux-2', apiKey: key };

function result(value: Parameters<typeof fauxToolCall>[1]['value'], tool = 'emit_result') {
  return fauxAssistantMessage(fauxToolCall(tool, { value }), { stopReason: 'toolUse' });
}

function failure(code: ModelGenerationError['code']) {
  return (error: unknown) => {
    assert.ok(error instanceof ModelGenerationError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.ok(Number.isFinite(error.durationMs) && error.durationMs >= 0);
    assert.equal(error.cause, undefined);
    return true;
  };
}

test('model gateway stays offline without a key and does not call faux', async () => {
  const { gateway, state } = createFauxModelGateway({ readEnv: () => '  ' });
  const offline = { mode: 'offline', provider: null, modelId: null, source: 'none' };
  assert.deepEqual(await gateway.getStatus(), offline);
  assert.throws(() => gateway.setByok({ ...byok, apiKey: '\n' }), {
    message: 'model_key_required',
  });
  assert.throws(() => gateway.setByok({ ...byok, modelId: 'outside-catalog' }), {
    message: 'invalid_model_config',
  });
  await assert.rejects(gateway.generate(request), failure('model_offline'));
  gateway.setByok(byok);
  assert.deepEqual(await gateway.getStatus(), {
    mode: 'live',
    provider: 'faux',
    modelId: 'faux-2',
    source: 'byok',
  });
  gateway.clearByok();
  assert.deepEqual(await gateway.getStatus(), offline);
  assert.equal(state.callCount, 0);
});

test('model gateway accepts validated TypeBox output after one corrective retry', async () => {
  const { gateway, state, setResponses } = createFauxModelGateway();
  gateway.setByok(byok);
  setResponses([
    result({ count: '2' }),
    (_context, options, _state, model) => {
      assert.equal(options?.apiKey === key, true);
      assert.equal(options?.maxRetries, 0);
      assert.equal(options?.maxTokens, 512);
      assert.equal(model.id, 'faux-2');
      return result({ count: 2 });
    },
  ]);
  const output = await gateway.generate({ ...request, maxTokens: 512 });
  assert.deepEqual(output.value, { count: 2 });
  assert.ok(Number.isFinite(output.durationMs) && output.durationMs >= 0);
  assert.equal(state.callCount, 2);
});

test('model gateway stops after two invalid tool outputs and hides their values', async () => {
  const { gateway, state, setResponses } = createFauxModelGateway();
  gateway.setByok(byok);
  setResponses([result({ count: 1 }, 'wrong_tool'), result({ count: key }), result({ count: 3 })]);
  await assert.rejects(gateway.generate(request), failure('model_invalid_output'));
  assert.equal(state.callCount, 2);
});

test('model output diagnostics give a safe schema path for retry, failure and never reveal values or secret field names', async () => {
  const { gateway, state, setResponses } = createFauxModelGateway();
  gateway.setByok(byok);
  const outputSecret = 'faux-model-output-secret';
  const invalid = { count: 'not an integer', OPENROUTER_API_KEY: outputSecret };
  let retryFeedback = '';
  setResponses([
    result(invalid),
    (request) => {
      retryFeedback = request.messages
        .filter(({ role }) => role === 'toolResult')
        .map(({ content }) => JSON.stringify(content))
        .join('\n');
      return result(invalid);
    },
  ]);
  let failureReason: ModelGenerationError | undefined;
  await assert.rejects(gateway.generate(request), (error: unknown) => {
    if (!(error instanceof ModelGenerationError)) return false;
    failureReason = error;
    return error.code === 'model_invalid_output';
  });

  assert.match(retryFeedback, /invalid structured output at \$\.count: expected an integer/);
  assert.match(retryFeedback, /sensitive-field/);
  assert.ok(failureReason?.reasons.some((reason) => reason.includes('$.count')));
  assert.equal(JSON.stringify(failureReason?.reasons).includes(outputSecret), false);
  assert.equal(JSON.stringify(failureReason?.reasons).includes('OPENROUTER_API_KEY'), false);
  assert.equal(retryFeedback.includes(outputSecret), false);
  assert.equal(retryFeedback.includes('OPENROUTER_API_KEY'), false);
  assert.equal(state.callCount, 2);
});

test('model gateway hides provider errors and never retries them', async () => {
  const { gateway, state, setResponses } = createFauxModelGateway();
  gateway.setByok(byok);
  setResponses([
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: `Provider echoed ${key}` }),
  ]);
  await assert.rejects(gateway.generate(request), failure('model_request_failed'));
  assert.equal(state.callCount, 1);
});

test('model gateway enforces a deadline even if a faux provider does not settle on abort', async () => {
  const { gateway, state, setResponses } = createFauxModelGateway();
  gateway.setByok(byok);
  let signal: AbortSignal | undefined;
  setResponses([
    (_context, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    },
  ]);
  await assert.rejects(gateway.generate({ ...request, timeoutMs: 50 }), failure('model_timeout'));
  assert.equal(signal?.aborted, true);
  assert.equal(state.callCount, 1);
});

test('structured output strips blank optional fields and accepts direct unwrapped schema payloads', async () => {
  const { gateway, setResponses, state } = createFauxModelGateway();
  gateway.setByok(byok);
  const cardSchema = Type.Object(
    {
      text: Type.String({ minLength: 1 }),
      formula: Type.Optional(Type.String({ minLength: 1 })),
      hint: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  );
  setResponses([
    result({ text: 'ok', formula: '', hint: null }),
    fauxAssistantMessage(fauxToolCall('emit_result', { text: 'direct', formula: '   ' }), {
      stopReason: 'toolUse',
    }),
  ]);
  const first = await gateway.generate({ schema: cardSchema, prompt: 'first', attempts: 1 });
  assert.deepEqual(first.value, { text: 'ok' });
  const second = await gateway.generate({ schema: cardSchema, prompt: 'second', attempts: 1 });
  assert.deepEqual(second.value, { text: 'direct' });
  assert.equal(state.callCount, 2);
});

test('a malformed bare object gets both envelope guidance and a safe schema path', async () => {
  const { gateway, setResponses, state } = createFauxModelGateway();
  gateway.setByok(byok);
  const rejectedValue = 'PRIVATE-COUNT-VALUE';
  setResponses([
    fauxAssistantMessage(fauxToolCall('emit_result', { count: rejectedValue }), {
      stopReason: 'toolUse',
    }),
    ({ messages }) => {
      const correction = JSON.stringify(messages);
      assert.match(correction, /emit_result must contain only the required value field/);
      assert.match(correction, /\$\.count: expected an integer/);
      assert.ok(!correction.includes(rejectedValue));
      return result({ count: 0 });
    },
  ]);
  assert.deepEqual((await gateway.generate(request)).value, { count: 0 });
  assert.equal(state.callCount, 2);
});

test('emit_result rejects mixed envelopes and bare sensitive fields even before a lossy normalizer', async () => {
  const { gateway, setResponses } = createFauxModelGateway();
  gateway.setByok(byok);
  const mixed = (value: Parameters<typeof fauxToolCall>[1]['value']) =>
    fauxAssistantMessage(fauxToolCall('emit_result', { count: 1, value }), {
      stopReason: 'toolUse',
    });
  setResponses([
    mixed({ password: 'faux-mixed-password' }),
    mixed({ count: 2 }),
    fauxAssistantMessage(
      fauxToolCall('emit_result', { count: 1, extra: { authorization: 'faux-bare-secret' } }),
      { stopReason: 'toolUse' },
    ),
  ]);
  const normalizeOutput = (value: unknown) => ({ count: (value as { count: unknown }).count });
  const generate = () => gateway.generate({ ...request, normalizeOutput, attempts: 1 });
  await assert.rejects(generate(), (error: unknown) => {
    assert.ok(error instanceof ModelGenerationError);
    assert.deepEqual(error.reasons, [
      'structured output contains a [sensitive-field]',
      'emit_result must contain only the required value field',
    ]);
    return true;
  });
  await assert.rejects(generate(), (error: unknown) => {
    assert.ok(error instanceof ModelGenerationError);
    assert.deepEqual(error.reasons, ['emit_result must contain only the required value field']);
    return true;
  });
  await assert.rejects(generate(), (error: unknown) => {
    assert.ok(error instanceof ModelGenerationError);
    assert.deepEqual(error.reasons, ['structured output contains a [sensitive-field]']);
    return true;
  });
});
