import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { liveAnswerFits, liveSceneLimits, runMode } from './m3/mode.mjs';
import { postBudget } from './m3/post-budget.mjs';
import transfer from './m3/scenarios/c1-transfer.mjs';
import { countedUpstream, fenceM3Tests, ledger, scratch } from './m3/test-loopback.mjs';
import { offlineNetworkEnv, offlineServerEnv } from './studio-test-env.mjs';

const key = 'SYNTHETIC_KEY_FOR_M3_BOUNDARY_TEST';
const budgetEnv = { M3_LIVE_POST_BUDGET: '2' };
const liveEnv = {
  ...budgetEnv,
  DEEPSEEK_API_KEY: key,
  OPENROUTER_API_KEY: 'SYNTHETIC_JUDGE_KEY_FOR_M3_BOUNDARY_TEST',
  HTTPS_PROXY: 'http://127.0.0.1:1',
};
const endpoint = 'https://model.example.invalid/v1/chat/completions';
const post = {
  method: 'POST',
  body: 'SYNTHETIC_MODEL_REQUEST_BODY',
  headers: { Authorization: key },
};
const sseHeaders = { 'content-type': 'text/event-stream' };

await fenceM3Tests();

test('M3 rejects live configuration without explicit --live', () => {
  assert.throws(
    () => runMode(undefined, { ...budgetEnv, DEEPSEEK_API_KEY: key }),
    /requires explicit --live/,
  );
  assert.deepEqual(runMode(undefined, { DEEPSEEK_API_KEY: key }), { mode: 'faux' });
});

test('M3 rejects --live without a safe positive integer POST budget', () => {
  for (const value of [undefined, '', '0', '-1', '1.5', '1e3', '9007199254740992']) {
    assert.throws(
      () => runMode(true, { ...liveEnv, M3_LIVE_POST_BUDGET: value }),
      /requires a positive integer M3_LIVE_POST_BUDGET/,
    );
  }
});

test('M3 rejects missing live keys or proxy configuration', () => {
  for (const name of ['DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY', 'HTTPS_PROXY']) {
    for (const value of [undefined, '   ']) {
      assert.throws(
        () => runMode(true, { ...liveEnv, [name]: value }),
        new RegExp(`requires ${name}`),
      );
    }
  }
  assert.throws(
    () => runMode(true, { ...liveEnv, HTTPS_PROXY: 'not a URL' }),
    /Invalid HTTPS_PROXY/,
  );
  const mode = runMode(true, liveEnv);
  assert.equal(mode.limit, 2);
  assert.equal(mode.modelEnv.OPENROUTER_API_KEY, undefined);
  assert.deepEqual(mode.exportEnv, {
    DEEPSEEK_API_KEY: key,
    OPENROUTER_API_KEY: liveEnv.OPENROUTER_API_KEY,
  });
});

test('M3 live authorization cannot raise the hard ceilings', (t) => {
  const file = join(scratch(t), 'ledger.jsonl');
  for (const limit of [115, 200]) {
    assert.throws(() => runMode(true, { ...liveEnv, M3_LIVE_POST_BUDGET: `${limit}` }), /<= 114/);
    assert.throws(() => postBudget(file, { mode: 'live', limit }), /<= 114/);
  }
  assert.equal(runMode(true, { ...liveEnv, M3_LIVE_POST_BUDGET: '114' }).limit, 114);
  assert.deepEqual(liveSceneLimits, {
    'C2-pressure': 36,
    'C1-transfer': 30,
    'C3-interrupt': 18,
    'C4-prereq': 30,
  });
  assert.throws(() => {
    liveSceneLimits['C2-pressure'] = 37;
  }, TypeError);
  const budget = postBudget(file, { mode: 'live', limit: 114 });
  assert.throws(() => budget.fetchFor('unknown', endpoint), /Unapproved live scene/);
});

test('M3 lower total fuse reserves before concurrent dispatch across scenes', async (t) => {
  const file = join(scratch(t), 'ledger.jsonl');
  const budget = postBudget(file, { mode: 'live', limit: 2 });
  let posts = 0;
  const send = async (_input, init) => {
    assert.equal(init.redirect, 'error');
    posts++;
    return new Response('BODY', { status: 502 });
  };
  const a = budget.fetchFor('C1-transfer', endpoint, send);
  const b = budget.fetchFor('C2-pressure', endpoint, send);
  const results = await Promise.allSettled([
    a(endpoint, post),
    b(endpoint, post),
    b(endpoint, post),
  ]);
  assert.equal(posts, 2, 'Lower total limit must block dispatch before either scene limit');
  assert.deepEqual(
    results.map(({ status }) => status),
    ['fulfilled', 'fulfilled', 'rejected'],
  );
  assert.match(results[2].reason.message, /budget_exhausted/);
  assert.equal(budget.total(), 2);
  const body = readFileSync(file, 'utf8');
  assert.ok([key, post.body, endpoint, 'BODY'].every((value) => !body.includes(value)));
  assert.deepEqual(
    body
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).event),
    ['reserved', 'reserved', 'budget_exhausted', 'headers', 'headers'],
  );
});

test('M3 scene fuse stops C2 POST #37 at the wire and leaves C1 usable', async (t) => {
  const file = join(scratch(t), 'ledger.jsonl');
  const { endpoint: url, received } = await countedUpstream(t);
  const budget = postBudget(file, { mode: 'live', limit: 114 });
  const c2 = budget.fetchFor('C2-pressure', url);
  const results = await Promise.allSettled(Array.from({ length: 37 }, () => c2(url, post)));
  assert.equal(received.length, 36, 'C2 POST #37 reached the upstream');
  assert.deepEqual(received, Array(36).fill('POST /model'), 'C2 POST #37 reached the upstream');
  assert.equal(
    results.slice(0, 36).every(({ value }) => value?.status === 204),
    true,
  );
  assert.equal(results[36].reason?.status, 'budget_exhausted');
  assert.equal(budget.postsFor('C2-pressure'), 36);
  budget.assertHealthy();
  const c1 = budget.fetchFor('C1-transfer', url);
  assert.equal((await c1(url, post)).status, 204);
  assert.equal(received.length, 37);
  const { event, scope, scenePosts } = ledger(file).find((row) => row.scope === 'scene');
  assert.deepEqual(
    { event, scope, scenePosts },
    { event: 'budget_exhausted', scope: 'scene', scenePosts: 36 },
  );
});

test('M3 authorizes all 114 POSTs but total fuse stops POST #115 at the wire', async (t) => {
  const file = join(scratch(t), 'ledger.jsonl');
  const { endpoint: url, received } = await countedUpstream(t);
  const budget = postBudget(file, { mode: 'live', limit: 114 });
  for (const [scene, count] of [
    ['C2-pressure', 36],
    ['C1-transfer', 30],
    ['C3-interrupt', 18],
    ['C4-prereq', 30],
  ]) {
    const call = budget.fetchFor(scene, url);
    for (let i = 0; i < count; i++) assert.equal((await call(url, post)).status, 204);
  }
  const c4 = budget.fetchFor('C4-prereq', url);
  const [extra] = await Promise.allSettled([c4(url, post)]);
  assert.equal(received.length, 114, 'Aggregate POST #115 reached the upstream');
  assert.deepEqual(
    received,
    Array(114).fill('POST /model'),
    'Aggregate POST #115 reached the upstream',
  );
  assert.match(extra.reason?.message ?? '', /Model POST fuse: budget_exhausted/);
  assert.throws(() => budget.assertHealthy(), /Model POST fuse: budget_exhausted/);
  const rows = ledger(file);
  assert.deepEqual(
    rows.filter(({ event }) => event === 'reserved').map(({ seq }) => seq),
    Array.from({ length: 114 }, (_, i) => i + 1),
  );
  assert.equal(
    rows.at(-1).scope,
    'total',
    'Global fuse takes precedence when both caps are reached',
  );
  assert.equal(rows.at(-1).total, 114);
  assert.throws(() => postBudget(file, { mode: 'live', limit: 114 }), { code: 'EEXIST' });
  assert.deepEqual(ledger(file), rows);
});

test('M3 POST transport has no implicit budget', (t) => {
  const file = join(scratch(t), 'ledger.jsonl');
  for (const invalid of [undefined, 0, 1.5, Infinity]) {
    assert.throws(
      () => postBudget(file, { mode: 'faux', limit: invalid }),
      /positive safe integer/,
    );
  }
});

test('M3 scripted transfer answer needs the matching visible question and verify checkpoint', () => {
  const rule = transfer.turns[1].liveAsk;
  const ask = {
    type: 'ask',
    checkpoint: 'verify',
    prompt: transfer.turns[0].output.next_ask.prompt,
  };
  assert.equal(liveAnswerFits(ask, rule), true);
  assert.equal(liveAnswerFits({ ...ask, prompt: ask.prompt.replace('2/10', '3/10') }, rule), false);
  assert.equal(
    liveAnswerFits({ ...ask, prompt: ask.prompt.replace('2/10', '2/100') }, rule),
    false,
  );
  assert.equal(liveAnswerFits({ ...ask, checkpoint: undefined }, rule), false);
});

test('M3 marks SDK reader release separately from SSE transport failure', async (t) => {
  const file = join(scratch(t), 'ledger.jsonl');
  const budget = postBudget(file, { mode: 'faux', limit: 3 });
  let posts = 0;
  const send = async () => {
    const body = new ReadableStream({
      start(controller) {
        if (++posts === 1) controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        else controller.error(new Error('broken_socket_marker'));
      },
      cancel() {
        throw new DOMException('local release', 'AbortError');
      },
    });
    return new Response(body, { headers: sseHeaders });
  };
  const call = budget.fetchFor('a', endpoint, send);
  const reader = (await call(endpoint, post)).body.getReader();
  assert.equal((await reader.read()).done, false);
  await reader.cancel();
  budget.assertHealthy();
  const broken = await call(endpoint, post);
  await assert.rejects(broken.text(), /Model SSE read failed/);
  await assert.rejects(call(endpoint, post), /transport_stopped/);
  assert.equal(posts, 2);
  assert.match(readFileSync(file, 'utf8'), /consumer_released[\s\S]+transport_failure/);
});

test('M3 rejects unapproved model destinations without dispatch', async (t) => {
  const budget = postBudget(join(scratch(t), 'ledger.jsonl'), { mode: 'faux', limit: 3 });
  const call = budget.fetchFor('a', endpoint, () => assert.fail('Dispatch must not happen'));
  await assert.rejects(
    call(endpoint.replace('https', 'http'), post),
    /unexpected_model_destination/,
  );
  await assert.rejects(call(endpoint, post), /unexpected_model_destination/);
  assert.equal(budget.total(), 0);
});

test('M3 live model authentication failure stops the whole transport', async (t) => {
  const budget = postBudget(join(scratch(t), 'ledger.jsonl'), { mode: 'live', limit: 114 });
  const c2 = budget.fetchFor(
    'C2-pressure',
    endpoint,
    async () => new Response(null, { status: 401 }),
  );
  const c1 = budget.fetchFor('C1-transfer', endpoint, () =>
    assert.fail('Dispatch must not happen'),
  );
  await assert.rejects(c2(endpoint, post), /model_auth_failed/);
  await assert.rejects(c1(endpoint, post), /model_auth_failed/);
  assert.equal(budget.total(), 1);
});

test('M3 a model 421 cannot replay a reserved POST at the wire', async (t) => {
  const { endpoint: url, received } = await countedUpstream(t, { status: 421 });
  const budget = postBudget(join(scratch(t), 'ledger.jsonl'), { mode: 'live', limit: 1 });
  const call = budget.fetchFor('C2-pressure', url);
  const [attempt] = await Promise.allSettled([call(url, post)]);
  assert.deepEqual(received, ['POST /model'], 'One reservation must not generate two POSTs');
  assert.equal(attempt.value?.status, 421);
  assert.equal(budget.total(), 1);
});

test('M3 offline TCP fence detects and blocks its loopback negative control', (t) => {
  const dir = scratch(t);
  const log = join(dir, 'fence.log');
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { createConnection } from 'node:net';
     import assert from 'node:assert/strict';
     assert.throws(() => createConnection({ host: '127.0.0.2', port: 1 }).on('error', () => {}), /Offline network fence/);`,
    ],
    {
      env: { ...offlineServerEnv(join(dir, 'no-dotenv')), ...offlineNetworkEnv(log) },
      encoding: 'utf8',
      timeout: 5_000,
    },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(readFileSync(log, 'utf8'), 'blocked non-loopback TCP connect\n');
});
