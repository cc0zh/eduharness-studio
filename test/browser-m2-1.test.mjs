import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startBrowserFixture } from './browser-fixture.mjs';

const key = 'synthetic-browser-private-sentinel';
const evidence = process.env.STUDIO_MODEL_SCREENSHOTS;
const offline = { mode: 'offline', provider: null, modelId: null, source: 'none' };
const live = { mode: 'live', provider: 'deepseek', modelId: 'deepseek-v4-pro', source: 'byok' };

async function screenshot(page, name) {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  const path = join(evidence, name);
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`M2-1 screenshot: ${path}`);
}

async function modelStatus(response) {
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['cache-control'], 'no-store');
  const body = await response.text();
  assert.equal(body.includes(key), false, 'BYOK key in API response');
  return JSON.parse(body);
}

async function assertNoSavedKey(page) {
  const state = await page.context().storageState({ indexedDB: true });
  const session = await page.evaluate(() => JSON.stringify(sessionStorage));
  assert.equal(JSON.stringify(state).includes(key), false, 'BYOK key in browser storage');
  assert.equal(session.includes(key), false, 'BYOK key in sessionStorage');
  assert.equal((await page.content()).includes(key), false, 'BYOK key in rendered HTML');
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
  const files = databaseFiles();
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
