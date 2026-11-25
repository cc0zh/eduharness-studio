import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startBrowserFixture } from './browser-fixture.mjs';
import { modelMockKey, modelMockList, startModelMock } from './model-mock.mjs';

const key = 'synthetic-browser-private-sentinel';
const evidence = process.env.STUDIO_MODEL_SCREENSHOTS;
const offline = { mode: 'offline', provider: null, modelId: null, source: 'none' };
const live = { mode: 'live', provider: 'deepseek', modelId: 'deepseek-v4-pro', source: 'byok' };

async function screenshot(page, name, directory = evidence) {
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`M2-1 screenshot: ${path}`);
}

async function modelStatus(response, secret = key) {
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['cache-control'], 'no-store');
  const body = await response.text();
  assert.equal(body.includes(secret), false, 'BYOK key in API response');
  return JSON.parse(body);
}

async function assertNoSavedKey(page, secret = key) {
  const state = await page.context().storageState({ indexedDB: true });
  const session = await page.evaluate(() => JSON.stringify(sessionStorage));
  assert.equal(JSON.stringify(state).includes(secret), false, 'BYOK key in browser storage');
  assert.equal(session.includes(secret), false, 'BYOK key in sessionStorage');
  assert.equal((await page.content()).includes(secret), false, 'BYOK key in rendered HTML');
}

test('M2-1 Chromium: BYOK switches via the real API, reloads without the key, clears to offline', {
  timeout: 45_000,
}, async (t) => {
  const { page, url, errors, logs, databaseFiles } = await startBrowserFixture(t);
  const external = [];
  await page.route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === url) return route.continue();
    external.push(origin);
    return route.abort();
  });

  await page.goto(url);
  const readStatus = async () => modelStatus(await page.request.get(`${url}/api/model`));
  const { providers, ...initial } = await readStatus();
  assert.deepEqual(initial, offline);
  assert.ok(
    providers.find(({ id }) => id === live.provider)?.models.some(({ id }) => id === live.modelId),
  );
  const offlineButton = page.getByRole('button', { name: /离线确定性模式.*BYOK/ });
  const liveButton = page.getByRole('button', { name: /在线模型已配置.*BYOK/ });
  const dialog = page.getByRole('dialog', { name: /模型与自带密钥/ });
  const keyInput = dialog.getByLabel('临时 API Key');
  await offlineButton.waitFor();
  await screenshot(page, '01-offline-header.png');
  await offlineButton.click();
  await dialog.waitFor();
  await screenshot(page, '02-offline-dialog.png');
  await dialog.getByLabel('供应商').selectOption(live.provider);
  await dialog.getByLabel('模型', { exact: true }).selectOption(live.modelId);
  await keyInput.fill(key);
  const update = async (method, button) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url() === `${url}/api/model` && res.request().method() === method,
      ),
      button.click(),
    ]);
    return modelStatus(response);
  };
  assert.deepEqual(await update('PUT', dialog.getByRole('button', { name: '保存配置' })), {
    ...live,
    providers,
  });
  await dialog.waitFor({ state: 'hidden' });
  await liveButton.waitFor();
  assert.deepEqual(await readStatus(), { ...live, providers });
  await assertNoSavedKey(page);
  await screenshot(page, '03-live-header.png');

  await page.reload();
  await liveButton.click();
  await dialog.getByText(/deepseek \/ deepseek-v4-pro.*临时 Key/).waitFor();
  assert.equal((await keyInput.inputValue()).length, 0);
  await assertNoSavedKey(page);
  await screenshot(page, '04-live-dialog-after-reload.png');
  assert.deepEqual(await update('DELETE', dialog.getByRole('button', { name: '清空临时密钥' })), {
    ...offline,
    providers,
  });
  await offlineButton.waitFor();
  assert.deepEqual(await readStatus(), { ...offline, providers });
  await screenshot(page, '05-cleared-offline.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await offlineButton.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await screenshot(page, '06-narrow-dialog.png');
  await page.keyboard.press('Escape');
  await offlineButton.waitFor({ state: 'visible' });
  await dialog.waitFor({ state: 'hidden' });

  await assertNoSavedKey(page);
  const files = await databaseFiles();
  assert.ok(files['studio.sqlite']?.length > 0);
  for (const [name, bytes] of Object.entries(files)) {
    assert.equal(bytes.includes(key), false, `BYOK key in ${name}`);
  }
  assert.equal(logs().includes(key), false, 'BYOK key in server logs');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    `M2-1 browser: offline → live → reload live (empty password field) → offline. Console errors: ${errors.length}; external origins: ${external.length}; no key in responses, browser storage, logs, or ${Object.keys(files).join(', ')}.`,
  );
});

test('M2-1 Chromium: recovers active BYOK when the PUT response is lost', {
  timeout: 35_000,
}, async (t) => {
  const { page, url, errors } = await startBrowserFixture(t);
  await page.goto(url);
  const offlineButton = page.getByRole('button', { name: /离线确定性模式.*BYOK/ });
  const dialog = page.getByRole('dialog', { name: /模型与自带密钥/ });
  await offlineButton.click();
  await dialog.getByLabel('供应商').selectOption(live.provider);
  await dialog.getByLabel('模型', { exact: true }).selectOption(live.modelId);
  await dialog.getByLabel('临时 API Key').fill(key);

  await page.route('**/api/model', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const stored = await route.fetch({ maxRedirects: 0 });
    assert.equal(stored.status(), 200);
    await route.abort();
  });
  await dialog.getByRole('button', { name: '保存配置' }).click();
  await dialog.getByRole('alert').waitFor();
  const { providers, ...stored } = await modelStatus(await page.request.get(`${url}/api/model`));
  assert.ok(providers.length > 0);
  assert.deepEqual(stored, live);
  await dialog.getByText(/deepseek \/ deepseek-v4-pro.*临时 Key/).waitFor();
  assert.equal((await dialog.getByLabel('临时 API Key').inputValue()).length, 0);
  await dialog.getByRole('button', { name: '清空临时密钥' }).click();
  await offlineButton.waitFor();
  assert.equal((await modelStatus(await page.request.get(`${url}/api/model`))).source, 'none');
  assert.ok(errors.every((error) => error === 'Failed to load resource: net::ERR_FAILED'));
  await assertNoSavedKey(page);
});

test('M2-1b Chromium: OpenRouter presets and live loopback catalog, save and reload', {
  timeout: 45_000,
}, async (t) => {
  const mock = await startModelMock(t);
  const { page, url, errors, logs, databaseFiles } = await startBrowserFixture(t);
  const capture = (name) => screenshot(page, name, process.env.STUDIO_MODEL_LIST_SCREENSHOTS ?? '');
  const external = [];
  await page.route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === url) return route.continue();
    external.push(origin);
    return route.abort();
  });
  await page.goto(url);
  const trigger = (status) => page.getByRole('button', { name: new RegExp(`${status}.*BYOK`) });
  const dialog = page.getByRole('dialog', { name: /模型与自带密钥/ });
  const provider = dialog.getByLabel('供应商');
  const base = dialog.getByLabel(/Base URI/);
  const password = dialog.getByLabel('临时 API Key');
  const select = dialog.getByLabel('模型', { exact: true });
  const id = dialog.getByLabel('模型 ID');
  const fetchList = dialog.getByRole('button', { name: '拉取模型', exact: true });
  const save = dialog.getByRole('button', { name: '保存配置' });
  const read = async () => modelStatus(await page.request.get(`${url}/api/model`), modelMockKey);
  const initial = await read();
  assert.equal(initial.mode, 'offline');

  await trigger('离线').click();
  await provider.selectOption('openrouter');
  const preset = initial.providers.find(({ id }) => id === 'openrouter').models[1];
  await select.selectOption(preset.id);
  assert.equal(await id.inputValue(), preset.id);
  assert.equal(await base.getAttribute('placeholder'), 'https://openrouter.ai/api/v1');
  await capture('01-openrouter-preset-desktop.png');

  await provider.selectOption('openai-compatible');
  assert.equal(await base.getAttribute('required'), '');
  await base.fill('file:///model-api');
  await password.fill(modelMockKey);
  await fetchList.click();
  await dialog
    .getByRole('alert')
    .getByText(/完整的 http/)
    .waitFor();
  assert.equal(mock.calls.length, 0);
  await capture('02-invalid-base-uri.png');

  await base.fill(`${mock.origin}/unsupported`);
  assert.equal(await password.inputValue(), '');
  await password.fill(modelMockKey);
  await fetchList.click();
  await dialog
    .getByRole('alert')
    .getByText(/不提供模型目录/)
    .waitFor();
  await id.fill('loop/manual-fallback');
  assert.equal(await save.isEnabled(), true);
  await capture('03-fetch-failure-manual.png');

  await base.fill(`${mock.origin}/v1/`);
  assert.equal(await password.inputValue(), '');
  await fetchList.click();
  await dialog.getByRole('alert').getByText('请输入此供应商和 Base URI 对应的 API Key。').waitFor();
  assert.deepEqual(
    mock.calls.map(({ path }) => path),
    ['/unsupported/models'],
  );
  await password.fill(modelMockKey);
  await fetchList.click();
  await dialog.getByRole('status').getByText('已拉取 3 个模型').waitFor();
  const chosen = modelMockList[1];
  await select.selectOption(chosen.id);
  assert.equal(await id.inputValue(), chosen.id);
  await capture('04-custom-models-desktop.png');
  await save.click();
  await dialog.waitFor({ state: 'hidden' });
  await trigger('在线').waitFor();
  const saved = await read();
  assert.equal(saved.source, 'byok');
  assert.equal(saved.provider, 'openai-compatible');
  assert.equal(saved.baseUrl, `${mock.origin}/v1`);
  assert.equal(saved.modelId, chosen.id);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await trigger('在线').click();
  assert.equal(await password.inputValue(), '');
  assert.equal(await base.inputValue(), `${mock.origin}/v1`);
  assert.equal(await id.inputValue(), chosen.id);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await fetchList.click();
  await dialog.getByRole('status').getByText('已拉取 3 个模型').waitFor();
  assert.equal(await select.inputValue(), chosen.id);
  await assertNoSavedKey(page, modelMockKey);
  await capture('05-reloaded-and-fetched-390px.png');
  await dialog.getByRole('button', { name: '清空临时密钥' }).click();
  await trigger('离线').waitFor();
  assert.equal((await read()).mode, 'offline');
  assert.deepEqual(
    mock.calls.map(({ path }) => path),
    ['/unsupported/models', '/v1/models', '/v1/models'],
  );
  assert.ok(mock.calls.every(({ authorization }) => authorization === `Bearer ${modelMockKey}`));
  assert.deepEqual(external, []);
  assert.ok(
    errors.every((error) => /status of (400|502)/.test(error)),
    'Unexpected browser console errors',
  );
  assert.equal(logs().includes(modelMockKey), false);
  for (const bytes of Object.values(await databaseFiles()))
    assert.equal(bytes.includes(modelMockKey), false);
  console.log(
    'M2-1b browser verified OpenRouter presets, custom catalog, manual fallback, reload with blank Key, and saved-Key reuse on loopback.',
  );
});

test('M2-1b Chromium does not forward credential bodies on redirect', {
  timeout: 25_000,
}, async (t) => {
  const mock = await startModelMock(t);
  const { page, url } = await startBrowserFixture(t);
  const forwarded = [];
  await page.route('**/redirected-model-request', (route) => {
    forwarded.push(route.request().method());
    return route.fulfill({ status: 502, body: 'redirect target' });
  });
  await page.route('**/api/model/fetch-models', (route) =>
    route.fulfill({
      status: 307,
      headers: { Location: '/redirected-model-request' },
    }),
  );
  await page.goto(url);
  await page.getByRole('button', { name: /离线确定性模式.*BYOK/ }).click();
  const dialog = page.getByRole('dialog', { name: /模型与自带密钥/ });
  await dialog.getByLabel('供应商').selectOption('openai-compatible');
  await dialog.getByLabel(/Base URI/).fill(`${mock.origin}/v1`);
  await dialog.getByLabel('临时 API Key').fill(modelMockKey);
  await dialog.getByRole('button', { name: '拉取模型', exact: true }).click();
  await dialog.getByRole('alert').getByText('拉取模型失败，可以重试或手填模型 ID。').waitFor();
  assert.deepEqual(forwarded, []);
  assert.deepEqual(mock.calls, []);
});
