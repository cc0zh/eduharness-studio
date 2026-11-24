import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspect } from 'node:util';
import type { ModelSettings } from '@eduharness-studio/engine';
import {
  createFauxModelGateway,
  createModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
  ModelGenerationError,
} from '@eduharness-studio/engine/models';
import { Type } from '@sinclair/typebox';
import { createServerApp } from '../apps/server/src/app.js';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { configureModels, loadStudioEnvironment } from '../apps/server/src/model-config.js';

const key = 'synthetic-byok-private-sentinel';

function put(body: string): RequestInit {
  return { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body };
}

async function redacted(response: Response, status = 200) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.equal(body.includes(key), false, 'Credential leaked into the HTTP response');
  return JSON.parse(body);
}

test('model API uses pi-ai env auth, supports BYOK precedence and falls back on DELETE', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-model-env-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, '.env');
  const envKey = 'synthetic-env-credential';
  writeFileSync(file, `OPENAI_API_KEY=${envKey}\nSTUDIO_MODEL_ID=gpt-5-mini\nPORT=3100\n`);
  assert.equal(loadStudioEnvironment({ STUDIO_ENV_FILE: file, PORT: '3200' }).PORT, '3200');
  const env = loadStudioEnvironment({ STUDIO_ENV_FILE: file, STUDIO_MODEL_PROVIDER: 'openai' });
  const models = configureModels(env);
  const withoutKey = configureModels({ ...env, OPENAI_API_KEY: '' });
  t.after(withoutKey.closeModelTransport);
  t.after(models.closeModelTransport);
  assert.equal((await withoutKey.gateway.getStatus()).mode, 'offline');
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  const app = createServerApp({ database, modelGateway: models.gateway });

  const envResponse = await app.request('/api/model');
  assert.equal((await envResponse.clone().text()).includes(envKey), false);
  const { providers, ...envStatus }: ModelSettings = await redacted(envResponse);
  assert.deepEqual(envStatus, {
    mode: 'live',
    provider: 'openai',
    modelId: 'gpt-5-mini',
    source: 'env',
  });
  assert.ok(providers.some(({ id }) => id === 'openai'));

  const payload = JSON.stringify({ provider: 'deepseek', modelId: 'deepseek-flash', apiKey: key });
  const { providers: menu, ...active } = await redacted(
    await app.request('/api/model', put(payload)),
  );
  assert.deepEqual(menu, providers);
  assert.deepEqual(active, {
    mode: 'live',
    provider: 'deepseek',
    modelId: 'deepseek-flash',
    source: 'byok',
  });
  assert.deepEqual(await redacted(await app.request('/api/model')), { ...active, providers });

  const cleared = await redacted(await app.request('/api/model', { method: 'DELETE' }));
  assert.deepEqual(cleared, { ...envStatus, providers });
});

test('model API rejects invalid inputs and sanitizes route exceptions without logging', async (t) => {
  const database = openStudioDatabase(':memory:');
  t.after(() => database.close());
  const loggers = [
    t.mock.method(console, 'error', () => {}),
    t.mock.method(console, 'warn', () => {}),
  ];
  const { gateway, state } = createFauxModelGateway();
  const app = createServerApp({ database, modelGateway: gateway });
  const credentials = { provider: 'faux', modelId: 'faux-1', apiKey: key };
  for (const body of [
    `{"apiKey":"${key}", invalid-json`,
    JSON.stringify({ ...credentials, [key]: true }),
    JSON.stringify({ ...credentials, modelId: key }),
  ]) {
    assert.deepEqual(await redacted(await app.request('/api/model', put(body)), 400), {
      error: 'invalid_model_config',
    });
  }
  assert.deepEqual(
    await redacted(
      await app.request('/api/model', put(JSON.stringify({ ...credentials, apiKey: ' ' }))),
      400,
    ),
    { error: 'model_key_required' },
  );
  assert.equal((await redacted(await app.request('/api/model'))).mode, 'offline');
  assert.equal(
    (await redacted(await app.request('/api/model', put(JSON.stringify(credentials))))).source,
    'byok',
  );
  assert.equal(state.callCount, 0);

  const appWithFailure = createServerApp({
    database,
    modelGateway: {
      ...gateway,
      setByok() {
        throw new Error(key);
      },
    },
  });
  assert.deepEqual(
    await redacted(
      await appWithFailure.request('/api/model', put(JSON.stringify(credentials))),
      500,
    ),
    {
      error: 'model_config_failed',
    },
  );
  assert.ok(loggers.every(({ mock }) => mock.callCount() === 0));
});

test('server disables native SDK logs for provider errors that echo credentials', async (t) => {
  const original = { OPENAI_LOG: process.env.OPENAI_LOG, ANTHROPIC_LOG: process.env.ANTHROPIC_LOG };
  t.after(() => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const loggers = (['debug', 'info', 'warn', 'error', 'log'] as const).map((name) =>
    t.mock.method(console, name, () => {}),
  );
  const authHeaders: boolean[] = [];

  for (const provider of ['openai', 'anthropic']) {
    process.env.OPENAI_LOG = 'debug';
    process.env.ANTHROPIC_LOG = 'debug';
    const { gateway } = configureModels({}, (options) =>
      createModelGateway({
        ...options,
        async fetch(_input, init) {
          const headers = new Headers(init?.headers);
          authHeaders.push(
            headers.get('authorization') === `Bearer ${key}` || headers.get('x-api-key') === key,
          );
          return new Response(`Provider rejected key ${key}`, { status: 401 });
        },
      }),
    );
    const modelId = gateway.getCatalog().find(({ id }) => id === provider)?.models[0]?.id;
    gateway.setByok({ provider, modelId, apiKey: key });
    await assert.rejects(gateway.generate({ prompt: 'Reply.', schema: Type.String() }), {
      name: 'ModelGenerationError',
      message: 'model_request_failed',
    });
  }
  assert.deepEqual(authHeaders, [true, true]);
  for (const logger of loggers) {
    for (const call of logger.mock.calls) {
      assert.equal(inspect(call.arguments).includes(key), false, 'Provider credential in SDK logs');
    }
  }
});

test('server HTTPS_PROXY transport reaches the model boundary and honors NO_PROXY', async (t) => {
  const targets: string[] = [];
  const proxy = createServer();
  proxy.on('connect', (req, socket) => {
    targets.push(req.url ?? '');
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    proxy.close();
  });
  const address = proxy.address();
  assert.ok(address && typeof address === 'object');
  const target = `127.0.0.1:${address.port}`;

  for (const noProxy of ['', '127.0.0.1']) {
    const { gateway, closeModelTransport } = configureModels(
      { HTTPS_PROXY: `http://127.0.0.1:${address.port}`, NO_PROXY: noProxy },
      (options) => {
        const faux = createFauxModelGateway(options);
        faux.setResponses([
          async (_context, requestOptions) => {
            const fetchModel = requestOptions?.fetch;
            assert.ok(fetchModel);
            await assert.rejects(
              fetchModel(`https://${target}`, { signal: requestOptions?.signal }),
            );
            return fauxAssistantMessage(fauxToolCall('emit_result', { value: 'ok' }), {
              stopReason: 'toolUse',
            });
          },
        ]);
        return faux.gateway;
      },
    );
    try {
      gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: key });
      assert.equal(
        (await gateway.generate({ prompt: 'Reply.', schema: Type.String(), timeoutMs: 5000 }))
          .value,
        'ok',
      );
    } finally {
      await closeModelTransport();
    }
    assert.deepEqual(targets, [target]);
  }
});

test('invalid HTTPS proxy permits offline startup and fails model calls without a direct fallback', async (t) => {
  const fetchSpy = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('', { status: 401 }),
  );
  const { gateway, closeModelTransport } = configureModels({
    HTTPS_PROXY: `http://${key}@[broken`,
  });
  t.after(closeModelTransport);
  assert.equal((await gateway.getStatus()).mode, 'offline');
  gateway.setByok({ provider: 'openai', modelId: 'gpt-5-mini', apiKey: key });
  await assert.rejects(gateway.generate({ prompt: 'Reply.', schema: Type.String() }), (error) => {
    assert.ok(error instanceof ModelGenerationError);
    assert.equal(error.message, 'model_request_failed');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(fetchSpy.mock.callCount(), 0);
});
