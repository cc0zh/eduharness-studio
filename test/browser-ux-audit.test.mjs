import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startBrowserFixture } from './browser-fixture.mjs';

const lessonRoot = '[data-session-id]';
const firstQuestion = /「它」从哪两个位置取信息/;
const secondQuestion = /只替换「小猫」的 V/;
const pausedReceipt = '已收到插话，继续后播放回应。';
const screenshots = process.env.STUDIO_UX_SCREENSHOTS;

async function screenshot(page, name) {
  if (!screenshots) return;
  mkdirSync(screenshots, { recursive: true });
  const path = join(screenshots, `${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`Screenshot: ${path}`);
}

async function observeOffline(t, page, url, label) {
  const host = new URL(url).host;
  const consoleErrors = [];
  const pageErrors = [];
  const external = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.context().route('**/*', (route) => {
    const address = new URL(route.request().url());
    if (address.host === host || address.protocol === 'data:') return route.continue();
    external.push(address.origin);
    return route.abort();
  });
  await page.context().routeWebSocket('**/*', (socket) => {
    const address = new URL(socket.url());
    if (address.host === host) socket.connectToServer();
    else {
      external.push(address.origin);
      return socket.close();
    }
  });
  t.after(() => {
    console.log(
      `${label}: console error = ${consoleErrors.length}; pageerror = ${pageErrors.length}; external requests = ${external.length}`,
    );
    assert.deepEqual(
      { consoleErrors, pageErrors, external },
      { consoleErrors: [], pageErrors: [], external: [] },
    );
  });
}

async function openDemo(page) {
  await page.getByRole('button', { name: '开始示范课：Transformer 自注意力机制' }).click();
  await page.locator(lessonRoot).waitFor();
}

async function expectAsk(page, question) {
  await page.getByText(question).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.activeElement?.id === 'class-answer');
  assert.equal(await page.getByRole('textbox', { name: '打断插话' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '插话', exact: true }).count(), 0);
}

async function answer(page, text) {
  await page.getByRole('textbox', { name: '写下你的回答' }).fill(text);
  await page.getByRole('button', { name: '提交回答' }).click();
  await page.locator('[data-ask-card]').waitFor({ state: 'hidden' });
}

async function interruptLayout(page, mobile) {
  const input = await page.getByRole('textbox', { name: '打断插话' }).boundingBox();
  const pause = await page.getByRole('button', { name: /^(暂停|继续)$/ }).boundingBox();
  const send = await page.getByRole('button', { name: '插话', exact: true }).boundingBox();
  assert.ok(input && pause && send);
  const label = mobile ? '390×844' : '1440×900';
  console.log(
    `${label}: interruption input ${input.width.toFixed(1)}×${input.height.toFixed(1)} CSS px`,
  );
  assert.ok(input.width >= 225, `${label}: interruption input must fit a readable draft`);
  assert.ok(input.x + input.width <= send.x && send.x + send.width <= page.viewportSize().width);
  if (mobile) assert.ok(input.y >= pause.y + pause.height && input.height >= 36);
  else assert.ok(Math.abs(input.y - pause.y) <= 5);
}

function playedStep(page) {
  return page.locator(lessonRoot).evaluate((root) => Number(root.dataset.playedStep));
}

async function submitInterrupt(page, { touch = false } = {}) {
  const send = page.getByRole('button', { name: '插话', exact: true });
  const [receipt] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/interrupt')),
    touch ? send.tap() : send.click(),
  ]);
  assert.equal(receipt.status(), 200);
}

function figureGeometry(figure) {
  return figure.evaluate((image) => {
    const grid = image.closest('[data-board-page]');
    const bounds = grid.getBoundingClientRect();
    const card = image.getBoundingClientRect();
    return {
      left: grid.scrollLeft,
      overflow: grid.scrollWidth - grid.clientWidth,
      fits: card.left >= bounds.left - 1 && card.right <= bounds.right + 1,
    };
  });
}

test('UX audit: responsive interruption, board columns and offline expectations', {
  timeout: 95_000,
}, async (t) => {
  const { page, url } = await startBrowserFixture(t);
  const browser = page.context().browser();
  console.log(`Chromium ${browser.version()}`);
  const model = await page.request.get(`${url}/api/model`);
  assert.equal(model.status(), 200);
  assert.equal((await model.json()).mode, 'offline');

  await t.test('390×844 touch: interruption and board columns', async (t) => {
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN',
    });
    mobile.setDefaultTimeout(8_000);
    await observeOffline(t, mobile, url, '390×844');
    t.after(() => mobile.close());
    await mobile.goto(url);
    await mobile.getByText(/离线自由建课只提供学习路线和通用课堂样例/).waitFor();
    await screenshot(mobile, '00-mobile-offline-intake');
    await openDemo(mobile);
    await expectAsk(mobile, firstQuestion);
    assert.equal(await mobile.getByRole('navigation', { name: '板书分栏定位' }).count(), 0);
    await answer(mobile, '「它」从同一句话里的小猫和垫子取信息。');

    const input = mobile.getByRole('textbox', { name: '打断插话' });
    await input.fill('这里的垫子也能给「它」提供信息吗？');
    await interruptLayout(mobile, true);
    await input.press('Home');
    await input.press('Shift+ArrowRight');
    await input.press('Shift+ArrowRight');
    await mobile.keyboard.insertText('图中');
    const draft = '图中的垫子也能给「它」提供信息吗？';
    assert.equal(await input.inputValue(), draft);
    await input.press('End');
    await mobile.getByText('正在讲解', { exact: true }).waitFor();
    await screenshot(mobile, '01-mobile-playing-interrupt-draft');

    await expectAsk(mobile, secondQuestion);
    const question = mobile.locator('[data-ask-card]');
    const columns = mobile.getByRole('navigation', { name: '板书分栏定位' });
    await columns.getByText('横滑白板，或点选栏号').waitFor();
    const graph = mobile.getByRole('img', { name: 'Q/K/V 权重流向' });
    const before = await figureGeometry(graph);
    assert.ok(before.overflow > 0 && !before.fits);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
    await screenshot(mobile, '02-mobile-board-column-guide');
    await columns.getByRole('button', { name: '查看第 2 栏' }).tap();
    const after = await figureGeometry(graph);
    assert.ok(after.left > before.left && after.fits, JSON.stringify(after));
    assert.equal(await question.isVisible(), true);
    assert.equal(await mobile.getByRole('button', { name: '下一页' }).isDisabled(), true);
    console.log(
      `390×844: sideways board scroll ${before.left}px → ${after.left}px; right-hand figure fits`,
    );
    await graph.scrollIntoViewIfNeeded();
    assert.ok(
      await graph.evaluate((image) => {
        const stage = image.closest('[data-lesson-stage]').getBoundingClientRect();
        const bounds = image.getBoundingClientRect();
        return bounds.top >= stage.top - 1 && bounds.bottom <= stage.bottom + 1;
      }),
    );
    await screenshot(mobile, '03-mobile-right-column-with-ask');
    await columns.getByRole('button', { name: '查看第 1 栏' }).tap();
    assert.equal((await figureGeometry(graph)).left, 0);

    await answer(mobile, '权重不变，因为 Q/K 不变；取回的信息变了，因为 V 变了。');
    assert.equal(await input.inputValue(), draft);
    await mobile.getByText('正在讲解', { exact: true }).waitFor();
    await columns.getByRole('button', { name: '查看第 2 栏' }).press('Space');
    assert.ok((await figureGeometry(graph)).fits);
    assert.equal(await mobile.getByRole('button', { name: '继续', exact: true }).count(), 0);
    await submitInterrupt(mobile, { touch: true });
    const caption = mobile.locator('[data-subtitle]');
    await caption.filter({ hasText: /先用书店例子区分三种角色/ }).waitFor();
    const pause = mobile.getByRole('button', { name: '暂停', exact: true });
    await pause.tap();
    const resume = mobile.getByRole('button', { name: '继续', exact: true });
    const cut = await playedStep(mobile);
    const oldCaption = await caption.textContent();
    const receipt = mobile.getByRole('status').filter({ hasText: pausedReceipt });
    assert.equal(await receipt.count(), 0);
    await input.fill('能换个角度讲讲为什么权重没变吗？');
    await submitInterrupt(mobile, { touch: true });
    await receipt.waitFor();
    assert.equal(await resume.isVisible(), true);
    assert.equal(await playedStep(mobile), cut);
    assert.equal(await caption.textContent(), oldCaption);
    assert.equal(await input.inputValue(), '');
    await screenshot(mobile, '04-mobile-paused-interrupt-received');
    // A quick re-pause before the next beat still has a committed, unplayed reply.
    await resume.tap();
    await pause.tap();
    await receipt.waitFor();
    assert.equal(await playedStep(mobile), cut);
    await resume.tap();
    await caption.filter({ hasText: /借书时你手里有检索需求/ }).waitFor();
    assert.ok((await playedStep(mobile)) > cut);
    assert.equal(await receipt.count(), 0);
    await screenshot(mobile, '05-mobile-resumed-interrupt-reply');
    await pause.tap();
    await resume.waitFor();
    assert.equal(await receipt.count(), 0);
  });

  await t.test('1440×900: offline copy and inline controls', async (t) => {
    await page.bringToFront();
    await page.setViewportSize({ width: 1440, height: 900 });
    await observeOffline(t, page, url, '1440×900');
    await page.goto(url);
    await page.getByText(/离线自由建课只提供学习路线和通用课堂样例/).waitFor();
    await screenshot(page, '06-desktop-offline-intake');
    await openDemo(page);
    // The fixture shares SQLite across contexts; use a fresh lesson, not the mobile continuation.
    const previous = await page.locator(lessonRoot).getAttribute('data-session-id');
    await page.getByRole('button', { name: '重新开始本课' }).click();
    await page.waitForFunction((id) => {
      const current = document.querySelector('[data-session-id]')?.dataset.sessionId;
      return current && current !== id;
    }, previous);
    await expectAsk(page, firstQuestion);
    await answer(page, '「它」从同一句话里的小猫和垫子取信息。');
    const graph = page.getByRole('img', { name: 'Q/K/V 权重流向' });
    await graph.waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('textbox', { name: '打断插话' }).fill('这个例子还能怎样理解？');
    await interruptLayout(page, false);
    assert.deepEqual(await figureGeometry(graph), { left: 0, overflow: 0, fits: true });
    assert.equal(await page.getByRole('navigation', { name: '板书分栏定位' }).count(), 0);
    await page.getByText('一拍可能只更新字幕、标记或板书。', { exact: true }).waitFor();
    await screenshot(page, '07-desktop-inline-playback-controls');
    const step = await playedStep(page);
    await page.getByRole('button', { name: '单拍前进 Step' }).click();
    await page.waitForFunction(
      (step) => Number(document.querySelector('[data-session-id]')?.dataset.playedStep) > step,
      step,
    );
    assert.equal(await playedStep(page), step + 1);
    assert.equal(await page.getByRole('button', { name: '继续', exact: true }).isVisible(), true);
  });
});
