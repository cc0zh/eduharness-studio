import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createModelGateway } from '@eduharness-studio/engine/models';
import { Type } from '@sinclair/typebox';
import { createServerApp } from '../apps/server/src/app.js';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { configureModels, loadStudioEnvironment } from '../apps/server/src/model-config.js';
import { modelMockKey, modelMockList, startModelMock } from './model-mock.mjs';

const custom = 'openai-compatible';
const temporaryKey = 'synthetic-temporary-key';

function json(method: 'PUT' | 'POST', body: object) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function sanitized(response: Response, status = 200) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.text();
  assert.equal(
    [modelMockKey, temporaryKey].some((key) => payload.includes(key)),
    false,
  );
  return JSON.parse(payload);
}

test('M2-1b catalog discovers OpenRouter and custom models using endpoint-scoped credentials', async (t) => {
  const mock = await startModelMock(t);
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  const { gateway, modelFetch, closeModelTransport } = configureModels({});
  t.after(closeModelTransport);
  const app = createServerApp({ database, modelGateway: gateway, modelFetch });
  const save = (input: object) => app.request('/api/model', json('PUT', input));
  const list = (input: object) => app.request('/api/model/fetch-models', json('POST', input));
  const initial = await sanitized(await app.request('/api/model'));
  const openRouter = initial.providers.find(({ id }: { id: string }) => id === 'openrouter');
  assert.equal(openRouter.defaultBaseUrl, 'https://openrouter.ai/api/v1');
  assert.ok(openRouter.models.length > 0);
  assert.equal(
    initial.providers.find(({ id }: { id: string }) => id === custom).requiresBaseUrl,
    true,
  );

  const secureList = [...modelMockList, { id: 'safe/echo-name', name: 'safe/echo-name' }];
  const byok = {
    provider: custom,
    baseUrl: `${mock.origin}/v1/`,
    modelId: 'manual/model',
    apiKey: modelMockKey,
  };
  assert.deepEqual(
    await sanitized(
      await list({
        provider: 'openrouter',
        baseUrl: `${mock.origin}/api/v1`,
        apiKey: temporaryKey,
      }),
    ),
    { models: secureList },
  );
  assert.equal((await sanitized(await app.request('/api/model'))).mode, 'offline');
  assert.equal((await sanitized(await save(byok))).baseUrl, `${mock.origin}/v1`);
  assert.deepEqual(await sanitized(await list({ provider: custom, apiKey: '' })), {
    models: secureList,
  });
  assert.deepEqual(
    await sanitized(await list({ provider: custom, baseUrl: byok.baseUrl, apiKey: temporaryKey })),
    { models: secureList },
  );
  const chosen = await sanitized(
    await save({ provider: custom, baseUrl: byok.baseUrl, modelId: modelMockList[1].id }),
  );
  assert.equal(chosen.modelId, modelMockList[1].id);
  assert.deepEqual(await sanitized(await app.request('/api/model')), chosen);
  assert.deepEqual(
    mock.calls.map(({ method, path }) => [method, path]),
    [
      ['GET', '/api/v1/models'],
      ['GET', '/v1/models'],
      ['GET', '/v1/models'],
    ],
  );
  const expected = [temporaryKey, modelMockKey, temporaryKey];
  assert.ok(
    mock.calls.every(({ authorization }, index) => authorization === `Bearer ${expected[index]}`),
  );
});

test('M2-1b rejects invalid endpoints and protects keys on upstream failures and redirects', async (t) => {
  const mock = await startModelMock(t);
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  const app = createServerApp({ database });
  const input = { provider: custom, apiKey: modelMockKey };
  const list = (body: object) => app.request('/api/model/fetch-models', json('POST', body));
  for (const baseUrl of [
    undefined,
    'file:///path',
    '/relative',
    `http://token:${modelMockKey}@localhost`,
    `${mock.origin}/v1?token=${modelMockKey}`,
    `${mock.origin}/${modelMockKey}`,
  ]) {
    assert.deepEqual(await sanitized(await list({ ...input, baseUrl }), 400), {
      error: 'invalid_base_url',
    });
  }
  assert.deepEqual(await sanitized(await list({ ...input, provider: 'anthropic' }), 400), {
    error: 'model_list_unsupported',
  });
  const saved = { ...input, modelId: 'loop/tutor', baseUrl: `${mock.origin}/v1` };
  await sanitized(await app.request('/api/model', json('PUT', saved)));
  const changed = { provider: custom, baseUrl: `${mock.origin}/elsewhere`, apiKey: '' };
  assert.deepEqual(await sanitized(await list(changed), 400), { error: 'model_key_required' });
  assert.deepEqual(
    await sanitized(await list({ provider: 'openrouter', baseUrl: saved.baseUrl }), 400),
    { error: 'model_key_required' },
  );
  const crossOrigin = json('POST', input);
  crossOrigin.headers['Sec-Fetch-Site'] = 'cross-site';
  assert.equal((await app.request('/api/model/fetch-models', crossOrigin)).status, 403);
  assert.deepEqual(mock.calls, []);

  for (const [path, error] of [
    ['unsupported', 'model_list_unsupported'],
    ['denied', 'model_list_http_error'],
    ['bad', 'model_list_invalid_response'],
    ['redirect', 'model_list_unavailable'],
  ]) {
    assert.deepEqual(
      await sanitized(await list({ ...input, baseUrl: `${mock.origin}/${path}` }), 502),
      { error },
    );
  }
  assert.equal(mock.calls.length, 4);
  assert.equal(mock.calls.at(-1).path, '/redirect/models');
  assert.equal((await sanitized(await app.request('/api/model'))).baseUrl, saved.baseUrl);
});

test('M2-1b native pi-ai OpenAI Completions uses the .env custom Base URI and Key', async (t) => {
  const mock = await startModelMock(t);
  const dir = mkdtempSync(join(tmpdir(), 'studio-compatible-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envPath = join(dir, '.env');
  const baseUrl = `${mock.origin}/v1`;
  // The .env uses deterministic fake input, while BYOK is never persisted by the app.
  writeFileSync(
    envPath,
    `STUDIO_MODEL_PROVIDER=${custom}\nSTUDIO_MODEL_BASE_URL=${baseUrl}/\nSTUDIO_MODEL_ID=loop/manual\nOPENAI_COMPATIBLE_API_KEY=${modelMockKey}\n`,
  );
  const { gateway, closeModelTransport } = configureModels(
    loadStudioEnvironment({ STUDIO_ENV_FILE: envPath }),
  );
  t.after(closeModelTransport);
  assert.deepEqual(await gateway.getStatus(), {
    mode: 'live',
    provider: custom,
    modelId: 'loop/manual',
    source: 'env',
    baseUrl,
  });
  assert.equal(
    (await gateway.generate({ schema: Type.String(), prompt: 'Reply.', timeoutMs: 5_000 })).value,
    'loopback-ok',
  );
  const [call] = mock.calls;
  assert.equal(call.path, '/v1/chat/completions');
  assert.equal(call.authorization === `Bearer ${modelMockKey}`, true);
  assert.equal(call.body.model, 'loop/manual');
});

test('M2-1b OpenRouter Claude keeps the provider-native Anthropic request path', async (t) => {
  const mock = await startModelMock(t);
  const { gateway, closeModelTransport } = configureModels({}, (options) =>
    createModelGateway({
      ...options,
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        return fetch(new URL(url.pathname, mock.origin), init);
      },
    }),
  );
  t.after(closeModelTransport);
  const modelId = '~anthropic/claude-haiku-latest';
  gateway.setByok({ provider: 'openrouter', modelId, apiKey: modelMockKey });
  const request = { schema: Type.String(), prompt: 'Reply.', timeoutMs: 5_000 };
  assert.equal((await gateway.generate(request)).value, 'loopback-anthropic-ok');
  gateway.setByok({
    provider: 'openrouter',
    modelId,
    baseUrl: `${mock.origin}/api/v1`,
    apiKey: modelMockKey,
  });
  assert.equal((await gateway.generate(request)).value, 'loopback-anthropic-ok');
  assert.deepEqual(
    mock.calls.map(({ path }) => path),
    ['/api/v1/messages', '/api/v1/messages'],
  );
});

test('M2-1b discovery uses a matching env key when BYOK points at another address', async (t) => {
  const envMock = await startModelMock(t);
  const byokMock = await startModelMock(t);
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  const { gateway, modelFetch, closeModelTransport } = configureModels({
    STUDIO_MODEL_PROVIDER: custom,
    STUDIO_MODEL_ID: 'loop/env',
    STUDIO_MODEL_BASE_URL: `${envMock.origin}/v1`,
    OPENAI_COMPATIBLE_API_KEY: temporaryKey,
  });
  t.after(closeModelTransport);
  gateway.setByok({
    provider: custom,
    modelId: 'loop/byok',
    baseUrl: `${byokMock.origin}/v1`,
    apiKey: modelMockKey,
  });
  const app = createServerApp({ database, modelGateway: gateway, modelFetch });
  for (const mock of [envMock, byokMock]) {
    await sanitized(
      await app.request(
        '/api/model/fetch-models',
        json('POST', { provider: custom, baseUrl: `${mock.origin}/v1/` }),
      ),
    );
  }
  assert.equal(envMock.calls[0].authorization === `Bearer ${temporaryKey}`, true);
  assert.equal(byokMock.calls[0].authorization === `Bearer ${modelMockKey}`, true);
});

test('M2-1b model catalog follows the configured proxy and honors NO_PROXY', async (t) => {
  const mock = await startModelMock(t);
  const targets: string[] = [];
  const proxy = createServer();
  proxy.on('connect', (req, socket) => {
    targets.push(req.url ?? '');
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());
  const address = proxy.address();
  assert.ok(address && typeof address === 'object');
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  const input = { provider: custom, baseUrl: `${mock.origin}/v1`, apiKey: modelMockKey };
  for (const [noProxy, status] of [
    ['', 502],
    ['127.0.0.1', 200],
  ] as const) {
    const { gateway, modelFetch, closeModelTransport } = configureModels({
      HTTP_PROXY: `http://127.0.0.1:${address.port}`,
      NO_PROXY: noProxy,
    });
    try {
      const app = createServerApp({ database, modelGateway: gateway, modelFetch });
      await sanitized(await app.request('/api/model/fetch-models', json('POST', input)), status);
    } finally {
      await closeModelTransport();
    }
  }
  assert.deepEqual(targets, [new URL(mock.origin).host]);
  assert.equal(mock.calls.length, 1);
});
