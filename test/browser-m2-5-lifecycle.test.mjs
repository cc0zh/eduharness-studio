import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startBrowserFixture } from './browser-fixture.mjs';
import { modelMockKey, modelMockList, startModelMock } from './model-mock.mjs';

const titles = ['辨认温度计读数', '找出测温条件', '复核温度变化'];
const askText = '这两个读数能直接证明水变热了吗？';

async function screenshot(page, name) {
  const directory = process.env.STUDIO_M2_5_SCREENSHOTS;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`M2.5 first lesson screenshot: ${path}`);
}

test('M2.5 Chromium: entering the first ready lesson shows real planned points and restores the same whiteboard', {
  timeout: 60_000,
}, async (t) => {
  const mock = await startModelMock(t);
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
  const setup = page.getByRole('dialog', { name: /模型与自带密钥/ });
  await setup.getByLabel('供应商').selectOption('openai-compatible');
  await setup.getByLabel(/Base URI/).fill(`${mock.origin}/v1`);
  await setup.getByLabel('临时 API Key').fill(modelMockKey);
  await setup.getByRole('button', { name: '拉取模型', exact: true }).click();
  await setup.getByRole('status').getByText('已拉取 3 个模型').waitFor();
  await setup.getByLabel('模型', { exact: true }).selectOption(modelMockList[0].id);
  await setup.getByRole('button', { name: '保存配置' }).click();
  await setup.waitFor({ state: 'hidden' });

  await page.getByLabel('学习主题').fill('温度测量与误差分析');
  await page.getByRole('button', { name: '开始轻调研' }).click();
  await page.getByText('我是初学者', { exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByText('弄懂核心概念', { exact: true }).click();
  await page.getByRole('button', { name: '生成课程蓝图' }).click();
  const enter = page.getByRole('link', { name: '进入白板', exact: true });
  await enter.waitFor();
  const chatCalls = () =>
    mock.calls.filter(({ method, path }) => method === 'POST' && path === '/v1/chat/completions');
  assert.equal(
    chatCalls().length,
    1,
    'publishing the blueprint must not plan the first lesson yet',
  );
  const lessonPath = await enter.getAttribute('href');
  assert.match(lessonPath, /\/lessons\/u1-l1$/);
  await enter.click();

  const progress = page.getByRole('navigation', { name: '本课要点进度' });
  const heading = page.getByRole('heading', { name: '杯水的两次读数' });
  const ask = page.locator('[data-ask-card]').getByText(askText, { exact: true });
  async function readWhiteboard() {
    await progress.waitFor();
    assert.deepEqual(
      await progress.locator(':scope > div > span > span:last-child').allTextContents(),
      titles,
    );
    assert.equal(await page.getByText(/选一个切入点|分清概念和例子/).count(), 0);
    await heading.waitFor();
    await ask.waitFor();
  }
  const activePath = `/api${lessonPath}/sessions/active`;
  async function snapshot() {
    const response = await page.request.get(`${url}${activePath}`);
    assert.equal(response.status(), 200);
    return response.json();
  }
  await readWhiteboard();
  await page.waitForFunction(async (path) => {
    const session = await (await fetch(path, { cache: 'no-store' })).json();
    return session?.state === 'handoff' && session.askStep === session.last_played_step_id;
  }, activePath);
  const before = await snapshot();
  assert.deepEqual(
    before.keypoints.map(({ title }) => title),
    titles,
  );
  assert.deepEqual(
    before.playedActions.map(({ type }) => type),
    ['board', 'speak', 'ask'],
  );
  assert.equal(before.playedActions.at(-1).prompt, askText);
  await screenshot(page, '01-first-lesson.png');

  await page.reload();
  await readWhiteboard();
  const after = await snapshot();
  assert.equal(after.session_id, before.session_id);
  assert.equal(after.generation, before.generation + 1);
  assert.equal(after.last_played_step_id, before.last_played_step_id);
  assert.deepEqual(after.keypoints, before.keypoints);
  assert.deepEqual(after.playedActions, before.playedActions);
  await screenshot(page, '02-first-lesson-restored.png');

  assert.equal(chatCalls().length, 2, 'the first lesson is planned once and reused after refresh');
  const prompt = chatCalls()[1].body.messages.find(({ role }) => role === 'user').content;
  assert.match(prompt, /Prepare one concise.*[\s\S]*Target lesson: .*"id":"u1-l1"/);

  assert.equal((await page.request.delete(`${url}/api/model`)).status(), 200);
  await page.getByRole('button', { name: '重新开始本课' }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForFunction((previous) => {
    const id = document.querySelector('[data-session-id]')?.dataset.sessionId;
    return id && id !== previous;
  }, before.session_id);
  await progress.getByText('选一个切入点', { exact: true }).waitFor();
  assert.equal(await progress.getByText(titles[0], { exact: true }).count(), 0);
  assert.equal(chatCalls().length, 2, 'an offline restart cannot call the model');

  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert.equal(logs().includes(modelMockKey), false);
  const files = await databaseFiles();
  assert.ok(files['studio.sqlite']?.length > 0);
  assert.ok(Object.values(files).every((bytes) => !bytes.includes(modelMockKey)));
  console.log(
    'M2.5 first lesson: three topic-specific points, acknowledged opening and same SQLite session after refresh; one loopback planning request, zero external origins.',
  );
});
