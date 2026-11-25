import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startBrowserFixture } from './browser-fixture.mjs';
import { modelMockKey, modelMockList, startModelMock } from './model-mock.mjs';

const screenshotDirectory = process.env.STUDIO_M2_3_SCREENSHOTS;
const selectedLabel = '分母只包含已经报警的样本';

async function screenshot(page, name) {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  const path = join(screenshotDirectory, name);
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`M2-3 screenshot: ${path}`);
}

async function stepToAsk(page) {
  for (let step = 0; step < 12; step += 1) {
    if (await page.locator('[data-ask-card]').isVisible()) return;
    const before = Number(await page.locator('[data-session-id]').getAttribute('data-played-step'));
    await page.getByRole('button', { name: '单拍前进 Step', exact: true }).click();
    await page.waitForFunction(
      (stepId) => Number(document.querySelector('[data-session-id]')?.dataset.playedStep) > stepId,
      before,
    );
  }
  assert.fail('The generated lesson never reached its choice ask');
}

test('M2-3 Chromium: loopback curriculum, lazy unlock, persistence and authoritative choice labels', {
  timeout: 60_000,
}, async (t) => {
  const mock = await startModelMock(t, { teacher: true, courses: true, unlockDelayMs: 1200 });
  const { page, url, errors, logs, databaseFiles } = await startBrowserFixture(t);
  const external = [];
  await page.addInitScript(() => {
    const fetchOnce = window.fetch.bind(window);
    let fail = true;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (fail && init?.method === 'POST' && url.endsWith('/unlock')) {
        fail = false;
        return new Response(JSON.stringify({ error: 'lesson_generation_failed' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return fetchOnce(input, init);
    };
  });
  await page.route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === url) return route.continue();
    external.push(origin);
    return route.abort();
  });
  await page.goto(url);
  await page.getByRole('button', { name: /离线确定性模式.*BYOK/ }).click();
  const dialog = page.getByRole('dialog', { name: /模型与自带密钥/ });
  await dialog.getByLabel('供应商').selectOption('openai-compatible');
  await dialog.getByLabel(/Base URI/).fill(`${mock.origin}/v1`);
  await dialog.getByLabel('临时 API Key').fill(modelMockKey);
  await dialog.getByRole('button', { name: '拉取模型', exact: true }).click();
  await dialog.getByRole('status').getByText('已拉取 3 个模型').waitFor();
  await dialog.getByLabel('模型', { exact: true }).selectOption(modelMockList[0].id);
  await dialog.getByRole('button', { name: '保存配置' }).click();
  await dialog.waitFor({ state: 'hidden' });

  await page.getByLabel('学习主题').fill('温度测量与误差分析');
  await page.getByRole('button', { name: '开始轻调研' }).click();
  await page.getByText('我是初学者', { exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByText('弄懂核心概念', { exact: true }).click();
  await page.getByRole('button', { name: '生成课程蓝图' }).click();
  await page.getByRole('heading', { name: '测量数据的学习路线' }).waitFor();
  await page.getByRole('heading', { name: '先读懂观测' }).waitFor();
  await page.getByRole('heading', { name: '再检验误差' }).waitFor();
  await page.getByRole('heading', { name: '重复测量与噪声' }).waitFor();
  await page.getByText('2 UNITS · 4 LESSONS', { exact: true }).waitFor();
  const courseId = new URL(page.url()).pathname.split('/')[2];
  await screenshot(page, '01-dynamic-course-blueprint.png');

  const lessonPath = `/courses/${courseId}/lessons/u1-l2`;
  const unlockButton = page.getByRole('button', { name: '解锁并进入' }).first();
  await unlockButton.click();
  await page
    .getByRole('alert')
    .getByText(/已核对课节仍处于锁定态，可以安全重试/)
    .waitFor();
  await screenshot(page, '02a-unlock-error-retry.png');
  const navigation = page.waitForURL(`${url}${lessonPath}`);
  const clicking = unlockButton.click();
  await page.getByRole('status').getByText('正在按课程路线生成这一节').waitFor();
  const duplicate = page.request.post(`${url}/api${lessonPath}/unlock`, { data: {} });
  await screenshot(page, '02b-lesson-unlock-loading.png');
  const duplicateResponse = await duplicate;
  assert.equal(duplicateResponse.status(), 200);
  await Promise.all([clicking, navigation]);

  await page.locator('[data-session-id]').waitFor();
  await page.getByRole('heading', { name: '重复测量与噪声' }).waitFor();
  const sessionId = await page.locator('[data-session-id]').getAttribute('data-session-id');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await stepToAsk(page);
  const [submission] = await Promise.all([
    page.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url() === `${url}/api/sessions/${sessionId}/answer`,
    ),
    page
      .locator('[data-ask-card]')
      .getByRole('button', { name: selectedLabel, exact: true })
      .click(),
  ]);
  const { option_id, ask_step_id } = submission.postDataJSON();
  assert.match(option_id, /^option-\d+$/);
  await page.locator('[data-ask-card]').waitFor({ state: 'hidden' });

  const chatCalls = mock.calls.filter(
    ({ path, method }) => path === '/v1/chat/completions' && method === 'POST',
  );
  const coursePrompts = chatCalls.flatMap(({ body }) =>
    body.messages
      .filter(({ role, content }) => role === 'user' && typeof content === 'string')
      .map(({ content }) => content),
  );
  assert.equal(
    coursePrompts.filter((prompt) => prompt.includes('Create a specific, concise')).length,
    1,
  );
  assert.equal(coursePrompts.filter((prompt) => prompt.includes('Prepare one concise')).length, 1);
  const teacherRequest = chatCalls.find(({ body }) =>
    body.messages.some(
      ({ role, content }) => role === 'user' && String(content).includes('"choice":true'),
    ),
  );
  assert.ok(teacherRequest, 'No Teacher Agent request was sent for the clicked choice');
  const teacherPrompt = teacherRequest.body.messages.find(({ role }) => role === 'user').content;
  const context = JSON.parse(
    teacherPrompt
      .split('\n')
      .find((line) => line.startsWith('课堂输入：'))
      .slice('课堂输入：'.length),
  );
  assert.equal(context.lastPlayed, ask_step_id);
  assert.equal(context.input.text, selectedLabel);
  assert.equal(context.input.choice, true);
  assert.equal('option_id' in context.input, false);
  assert.equal(context.currentAsk.options.length, 2);
  assert.ok(context.currentAsk.options.includes(selectedLabel));
  assert.ok(context.currentAsk.options.includes('所有带标签的样本'));
  assert.equal(teacherPrompt.includes(JSON.stringify(option_id)), false);
  assert.doesNotMatch(teacherPrompt, /"option-\d+"/);

  await page.reload();
  await page.waitForFunction(
    (id) => document.querySelector('[data-session-id]')?.dataset.sessionId === id,
    sessionId,
  );
  await screenshot(page, '03-classroom-restored-after-refresh.png');

  const savedBlueprint = await page.request.get(`${url}/api/courses/${courseId}`);
  assert.equal(savedBlueprint.status(), 200);
  const units = (await savedBlueprint.json()).units;
  assert.equal(units[0].lessons[1].status, 'ready');
  assert.equal(units[0].lessons[2], undefined);
  const remainingLocked = units
    .flatMap(({ lessons }) => lessons)
    .filter(({ status }) => status === 'locked');
  assert.equal(remainingLocked.length, 2);
  await page.goto(`${url}/courses/${courseId}`);
  await page.getByRole('link', { name: '进入白板' }).nth(1).waitFor();
  const [reloadedBlueprint] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${url}/api/courses/${courseId}` &&
        response.request().method() === 'GET',
    ),
    page.reload(),
  ]);
  console.log(
    `M2-3 blueprint reload: status=${reloadedBlueprint.status()} readyLinks=${await page.getByRole('link', { name: '进入白板' }).count()}`,
  );
  await page.getByRole('link', { name: '进入白板' }).nth(1).waitFor();
  await screenshot(page, '04-blueprint-restored-after-refresh.png');

  const cleared = await page.request.delete(`${url}/api/model`);
  assert.equal(cleared.status(), 200);
  await page.getByRole('link', { name: '进入白板' }).nth(1).click();
  await page.locator('[data-session-id]').waitFor();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await stepToAsk(page);
  const preOfflineCallCount = chatCalls.length;
  await page.locator('[data-ask-card] textarea').fill('我会先重复测量，再比较三次读数的变化。');
  await page.getByRole('button', { name: '提交回答' }).click();
  await page.locator('[data-ask-card]').waitFor({ state: 'hidden' });
  await stepToAsk(page);
  await screenshot(page, '05-offline-reopen-continues-after-answer.png');
  const postOfflineCalls = mock.calls.filter(
    ({ path, method }) => path === '/v1/chat/completions' && method === 'POST',
  );
  assert.equal(postOfflineCalls.length, preOfflineCallCount);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}/courses/${courseId}`);
  await page.getByRole('link', { name: '进入白板' }).nth(1).waitFor();
  assert.equal(await page.getByRole('button', { name: '解锁并进入' }).count(), 2);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await screenshot(page, '06-blueprint-390px.png');

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.equal(logs().includes(modelMockKey), false);
  for (const [name, bytes] of Object.entries(databaseFiles())) {
    assert.equal(bytes.includes(modelMockKey), false, `BYOK key persisted in ${name}`);
  }
  console.log(
    'M2-3 evidence: overlapping unlocks made one model request; console errors=0; external origins=0',
  );
});
