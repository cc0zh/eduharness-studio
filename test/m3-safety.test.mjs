import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { liveAnswerFits, runMode } from './m3/mode.mjs';
import { postBudget } from './m3/post-budget.mjs';
import transfer from './m3/scenarios/c1-transfer.mjs';
import { offlineNetworkEnv, offlineServerEnv } from './studio-test-env.mjs';

const key = 'SYNTHETIC_KEY_FOR_M3_BOUNDARY_TEST';
const budgetEnv = { M3_LIVE_POST_BUDGET: '2' };
const endpoint = 'https://model.example.invalid/v1/chat/completions';
const post = {
  method: 'POST',
  body: 'SYNTHETIC_MODEL_REQUEST_BODY',
  headers: { Authorization: key },
};
const sseHeaders = { 'content-type': 'text/event-stream' };

function scratch(t) {
  const path = mkdtempSync(join(tmpdir(), 'studio-m3-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

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
      () => runMode(true, { M3_LIVE_POST_BUDGET: value, DEEPSEEK_API_KEY: key }),
      /requires a positive integer M3_LIVE_POST_BUDGET/,
    );
  }
});

test('M3 rejects --live without the required key', () => {
  for (const value of [undefined, '   ']) {
    assert.throws(
      () => runMode(true, { ...budgetEnv, DEEPSEEK_API_KEY: value }),
      /requires DEEPSEEK_API_KEY/,
    );
  }
  assert.equal(runMode(true, { ...budgetEnv, DEEPSEEK_API_KEY: key }).limit, 2);
});

test('M3 reserves each POST before dispatch, even across concurrent scenes', async (t) => {
  const file = join(scratch(t), 'ledger.jsonl');
  const budget = postBudget(file, 2);
  let posts = 0;
  const send = async (_input, init) => {
    assert.equal(init.redirect, 'error');
    posts++;
    return new Response('BODY', { status: 502 });
  };
  const a = budget.fetchFor('a', endpoint, send);
  const b = budget.fetchFor('b', endpoint, send);
  const results = await Promise.allSettled([
    a(endpoint, post),
    b(endpoint, post),
    b(endpoint, post),
  ]);
  assert.deepEqual(
    results.map(({ status }) => status),
    ['fulfilled', 'fulfilled', 'rejected'],
  );
  assert.match(results[2].reason.message, /budget_exhausted/);
  assert.equal(posts, 2);
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

test('M3 POST transport has no implicit budget', (t) => {
  const file = join(scratch(t), 'ledger.jsonl');
  for (const invalid of [undefined, 0, 1.5, Infinity]) {
    assert.throws(() => postBudget(file, invalid), /positive safe integer/);
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
  const budget = postBudget(file, 3);
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
  const budget = postBudget(join(scratch(t), 'ledger.jsonl'), 3);
  const call = budget.fetchFor('a', endpoint, () => assert.fail('Dispatch must not happen'));
  await assert.rejects(
    call(endpoint.replace('https', 'http'), post),
    /unexpected_model_destination/,
  );
  await assert.rejects(call(endpoint, post), /unexpected_model_destination/);
  assert.equal(budget.total(), 0);
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
