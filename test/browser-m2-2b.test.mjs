import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startBrowserFixture } from './browser-fixture.mjs';
import { modelMockKey, modelMockList, startModelMock } from './model-mock.mjs';

const screenshotDirectory = process.env.STUDIO_M2_2B_SCREENSHOTS;
const askCard = '[data-ask-card]';

async function screenshot(page, name) {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  const path = join(screenshotDirectory, name);
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`M2-2b screenshot: ${path}`);
}

async function pause(page) {
  const pauseButton = page.getByRole('button', { name: '暂停', exact: true });
  if (await pauseButton.isVisible()) {
    await pauseButton.click();
    await page.getByRole('button', { name: '继续', exact: true }).waitFor();
  }
}

async function step(page) {
  const before = Number(await page.locator('[data-session-id]').getAttribute('data-played-step'));
  await page.getByRole('button', { name: '单拍前进 Step', exact: true }).click();
  await page.waitForFunction(
    (stepId) => Number(document.querySelector('[data-session-id]')?.dataset.playedStep) > stepId,
    before,
  );
}

async function handoff(page) {
  for (let index = 0; index < 8 && !(await page.locator(askCard).isVisible()); index++) {
    await step(page);
  }
  await page.locator(askCard).waitFor();
}

async function xray(page, url, sessionId) {
  const response = await page.request.get(`${url}/api/sessions/${sessionId}/xray`);
  assert.equal(response.status(), 200);
  return response.json();
}

test('M2-2b Chromium: loopback BYOK, native calc_verify tool cycle, guardrails and X-Ray', {
  timeout: 60_000,
}, async (t) => {
  const mock = await startModelMock(t, { teacher: true });
  const { page, url, errors, logs, databaseFiles } = await startBrowserFixture(t);
  const external = [];
  await page.route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === url) return route.continue();
    external.push(origin);
    return route.abort();
  });

  await page.goto(url);
  const statusButton = page.getByRole('button', { name: /离线确定性模式.*BYOK/ });
  await statusButton.click();
  const dialog = page.getByRole('dialog', { name: /模型与自带密钥/ });
  await dialog.getByLabel('供应商').selectOption('openai-compatible');
  await dialog.getByLabel(/Base URI/).fill(`${mock.origin}/v1`);
  await dialog.getByLabel('临时 API Key').fill(modelMockKey);
  await dialog.getByRole('button', { name: '拉取模型', exact: true }).click();
  await dialog.getByRole('status').getByText('已拉取 3 个模型').waitFor();
  await dialog.getByLabel('模型', { exact: true }).selectOption(modelMockList[0].id);
  await screenshot(page, '01-loopback-model-catalog.png');
  await dialog.getByRole('button', { name: '保存配置' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /在线模型已配置.*BYOK/ }).waitFor();

  const generated = await page.request.post(`${url}/api/intake/generate`, {
    data: { topic: '数量合并', foundation: 'experienced', goal: 'understand' },
  });
  assert.equal(generated.status(), 201);
  const course = await generated.json();
  const lesson = course.units[0].lessons[0];
  const lessonPath = `/courses/${course.id}/lessons/${lesson.id}`;
  const [started] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${url}/api${lessonPath}/sessions` &&
        response.request().method() === 'POST',
    ),
    page.goto(`${url}${lessonPath}`),
  ]);
  assert.equal(
    started.status(),
    201,
    `Teacher Agent session start failed: ${await started.text()}\n${logs()}`,
  );
  await page.getByRole('heading', { name: '先观察合并' }).waitFor();
  await pause(page);
  await handoff(page);
  await page.locator(askCard).getByText('两组合并后共有多少？', { exact: true }).waitFor();
  await screenshot(page, '02-teacher-opening-after-calculation.png');

  const activeResponse = await page.request.get(`${url}/api${lessonPath}/sessions/active`);
  assert.equal(activeResponse.status(), 200);
  const active = await activeResponse.json();
  let trace = await xray(page, url, active.session_id);
  const openingTool = trace.spans.find(
    ({ kind, name }) => kind === 'tool' && name === 'calc_verify',
  );
  assert.ok(openingTool, 'No real calc_verify tool Span was written by the Teacher Agent');
  assert.deepEqual(openingTool.input, { expression: '2 + 3', format: 'decimal' });
  assert.deepEqual(openingTool.result, { ok: true, value: 5, text: '5', approximate: false });
  assert.ok(Number.isFinite(openingTool.durationMs) && openingTool.durationMs >= 0);
  assert.ok(trace.teacherTurns.some(({ diagnosis }) => diagnosis?.status === 'opening'));
  assert.ok(trace.transitions.length > 0, 'TeachingState transitions were not recorded');
  await screenshot(page, '03-xray-tool-span-and-opening-diagnosis.png');

  const firstAsk = page.locator(askCard);
  await firstAsk.locator('fieldset button').last().click();
  await firstAsk.waitFor({ state: 'hidden' });
  await pause(page);
  await handoff(page);
  trace = await xray(page, url, active.session_id);
  assert.ok(
    trace.teacherTurns.some(({ guardrails }) =>
      guardrails.some(({ reasons }) =>
        reasons.some((reason) => reason.includes('mastery requires')),
      ),
    ),
    'Expected the state-machine guardrail to reject an unverified mastery claim',
  );

  await page.getByRole('switch', { name: 'Agent X-Ray' }).click();
  const drawer = page.getByRole('dialog', { name: 'Agent X-Ray' });
  await drawer.getByRole('tab', { name: '公开对话投影与追踪' }).click();
  await drawer.getByText('opening', { exact: true }).waitFor();
  await drawer.getByText('护栏拦截与重试', { exact: true }).waitFor();
  const span = drawer.locator('[data-span-kind="tool"]');
  await span.getByText('calc_verify · 安全计算').waitFor();
  await span.getByText(/脱敏入参.*2 \+ 3/).waitFor();
  await span.getByText(/脱敏结果.*"text":"5"/).waitFor();
  await screenshot(page, '04-xray-guardrail-and-calc-verify.png');

  const requests = mock.calls.filter(
    ({ path, method }) => path === '/v1/chat/completions' && method === 'POST',
  );
  assert.ok(
    requests.length >= 3,
    'Expected calc tool request, structured opening and guarded correction',
  );
  assert.ok(
    requests.some(({ body }) =>
      body.tools?.some(({ function: tool }) => tool.name === 'calc_verify'),
    ),
  );
  assert.ok(
    requests.some(({ body }) =>
      body.messages.some(
        ({ role, content }) => role === 'tool' && String(content).includes('"text":"5"'),
      ),
    ),
    'The computed result was not returned to the model before the final structured output',
  );
  assert.ok(
    requests.some(({ body }) =>
      body.messages.some(
        ({ role, content }) => role === 'user' && String(content).includes('上一份回合被护栏拦截'),
      ),
    ),
    'The model did not receive a state-machine correction attempt',
  );
  assert.ok(mock.calls.some(({ path, method }) => path === '/v1/models' && method === 'GET'));
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert.equal(logs().includes(modelMockKey), false);
  for (const bytes of Object.values(databaseFiles()))
    assert.equal(bytes.includes(modelMockKey), false);
  console.log(
    'M2-2b loopback browser verified BYOK catalog, calc_verify-before-output, guardrail correction, readable X-Ray, zero console errors and no external requests.',
  );
});
