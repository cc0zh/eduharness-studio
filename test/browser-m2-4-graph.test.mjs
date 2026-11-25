import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startBrowserFixture } from './browser-fixture.mjs';
import { modelMockKey, modelMockList, startModelMock } from './model-mock.mjs';

const screenshotDirectory = process.env.STUDIO_M2_4_GRAPH_SCREENSHOTS;

async function configureAndUnlock(t, graph) {
  const mock = await startModelMock(t, { teacher: true, graph });
  const { page, url, errors, logs, databaseFiles } = await startBrowserFixture(t);
  const external = [];
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

  await page.getByLabel('学习主题').fill('三角形面积中的底边与垂高');
  await page.getByRole('button', { name: '开始轻调研' }).click();
  await page.getByText('我是初学者', { exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByText('弄懂核心概念', { exact: true }).click();
  await page.getByRole('button', { name: '生成课程蓝图' }).click();
  await page.waitForURL(/\/courses\/course-/);
  const course = await page.request.get(
    `${url}/api/courses/${new URL(page.url()).pathname.split('/')[2]}`,
  );
  assert.equal(course.status(), 200);
  const blueprint = await course.json();
  const lessons = blueprint.units.flatMap(({ lessons }) => lessons);
  assert.equal(lessons[0].status, 'ready');
  assert.ok(lessons.slice(1).every(({ status }) => status === 'locked'));
  const lessonPath = `/courses/${blueprint.id}/lessons/${lessons[1].id}`;
  if (graph === 'timeout') page.setDefaultTimeout(20_000);
  const navigation = page.waitForURL(`${url}${lessonPath}`);
  await page.getByRole('button', { name: '解锁并进入' }).first().click();
  try {
    await navigation;
  } catch {
    const unlock = mock.calls.filter(({ path }) => path === '/v1/chat/completions').length;
    const alert = await page.getByRole('alert').allTextContents();
    throw new Error(
      `Locked lesson did not open: ${page.url()}; model calls=${unlock}; alert=${alert}`,
    );
  }
  await page.locator('[data-session-id]').waitFor();
  const sessionId = await page.locator('[data-session-id]').getAttribute('data-session-id');
  const pause = page.getByRole('button', { name: '暂停', exact: true });
  if (await pause.isVisible()) await pause.click();
  return { page, url, errors, external, logs, databaseFiles, mock, sessionId };
}

async function finish(t, graph) {
  const result = await configureAndUnlock(t, graph);
  const { page, url, errors, external, logs, databaseFiles, mock, sessionId } = result;
  const xray = await page.request.get(`${url}/api/sessions/${sessionId}/xray`);
  assert.equal(xray.status(), 200);
  const trace = await xray.json();
  const span = trace.spans.find(({ name }) => name === 'graph_generator');
  assert.ok(span, 'GraphGenerator duration was absent from X-Ray');
  assert.ok(Number.isFinite(span.durationMs) && span.durationMs >= 0);
  assert.equal(external.length, 0);
  assert.deepEqual(errors, []);
  assert.equal(logs().includes(modelMockKey), false);
  for (const bytes of Object.values(await databaseFiles()))
    assert.equal(bytes.includes(modelMockKey), false);
  const requests = mock.calls.filter(
    ({ path, method }) => path === '/v1/chat/completions' && method === 'POST',
  );
  assert.ok(requests.length <= 25);
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, `graph-${graph}.png`),
      animations: 'disabled',
    });
  }
  return { page, span, errors };
}

test('M2-4 Chromium loopback: a legal copperplate graph is rendered as a static image', {
  timeout: 60_000,
}, async (t) => {
  const { page, span } = await finish(t, 'safe');
  const card = page.locator('[data-card-kind="graph"]');
  await card.waitFor();
  await card.locator('[data-graph="true"] img').waitFor();
  assert.ok(await card.locator('img').evaluate((image) => image.naturalWidth > 0));
  assert.deepEqual(span.result, { status: 'generated' });
  await page.getByRole('switch', { name: 'Agent X-Ray' }).click();
  const drawer = page.getByRole('dialog', { name: 'Agent X-Ray' });
  await drawer.getByRole('tab', { name: '公开对话投影与追踪' }).click();
  await drawer.getByText('graph_generator · 铜版风配图').waitFor();
});

test('M2-4 Chromium loopback: a malicious SVG is rejected and text boardwork remains', {
  timeout: 60_000,
}, async (t) => {
  const { page, span } = await finish(t, 'malicious');
  const card = page
    .locator('[data-board-card]')
    .filter({ has: page.getByRole('heading', { name: '样本与阈值', exact: true }) });
  await card.waitFor();
  assert.equal(await card.getAttribute('data-card-kind'), 'board');
  assert.match(await card.textContent(), /已观测的样本/);
  assert.equal(await page.locator('[data-graph="true"]').count(), 0);
  assert.deepEqual(span.result, { status: 'fallback', reason: 'unsafe_svg' });
  await page.getByRole('switch', { name: 'Agent X-Ray' }).click();
  const drawer = page.getByRole('dialog', { name: 'Agent X-Ray' });
  await drawer.getByRole('tab', { name: '公开对话投影与追踪' }).click();
  await drawer.getByText(/"reason":"unsafe_svg"/).waitFor();
});

test('M2.5 Chromium loopback: a marked panel keeps its board and paints the exact highlight', {
  timeout: 60_000,
}, async (t) => {
  const { page, url, sessionId, errors, external, mock } = await configureAndUnlock(t, 'marked');
  const card = page
    .locator('[data-board-card]')
    .filter({ has: page.getByRole('heading', { name: '样本与阈值' }) });
  const step = page.getByRole('button', { name: '单拍前进 Step', exact: true });
  if (!(await card.isVisible())) await step.click();
  await card.waitFor();
  const highlight = card.locator('[data-highlight="highlight"]');
  if (!(await highlight.isVisible())) await step.click();
  await highlight.waitFor({ state: 'visible' });
  assert.equal(await highlight.textContent(), '已观测的样本');
  assert.equal(await card.getAttribute('data-card-kind'), 'board');
  assert.equal(await card.locator('[data-graph]').count(), 0);
  assert.equal(
    mock.calls.some(({ body }) =>
      body?.messages.some(({ content }) => String(content).includes('绘图任务')),
    ),
    false,
  );
  const xray = await page.request.get(`${url}/api/sessions/${sessionId}/xray`);
  assert.equal(xray.status(), 200);
  assert.equal(
    (await xray.json()).spans.some(({ name }) => name === 'graph_generator'),
    false,
  );
  assert.equal(external.length, 0);
  assert.deepEqual(errors, []);
});

test('M2-4 Chromium loopback: an SVG timeout degrades to text without blocking playback', {
  timeout: 60_000,
}, async (t) => {
  const { page, span, errors } = await finish(t, 'timeout');
  const card = page
    .locator('[data-board-card]')
    .filter({ has: page.getByRole('heading', { name: '样本与阈值', exact: true }) });
  await card.waitFor();
  assert.equal(await card.getAttribute('data-card-kind'), 'board');
  assert.match(await card.textContent(), /已观测的样本/);
  assert.deepEqual(span.result, { status: 'fallback', reason: 'timeout' });
  const before = Number(await page.locator('[data-session-id]').getAttribute('data-played-step'));
  await page.getByRole('button', { name: '单拍前进 Step', exact: true }).click();
  await page.waitForFunction(
    (stepId) => Number(document.querySelector('[data-session-id]')?.dataset.playedStep) > stepId,
    before,
  );
  assert.deepEqual(errors, []);
});
