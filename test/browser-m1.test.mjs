import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startBrowserFixture } from './browser-fixture.mjs';

const lessonRoot = '[data-session-id]';
const askCard = '[data-ask-card]';
const evidenceDir = process.env.STUDIO_E2E_SCREENSHOTS;
const useNpmDev = process.env.STUDIO_E2E_DEV === '1';

async function screenshot(page, name) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  const path = join(evidenceDir, name);
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`Screenshot: ${path}`);
}

function playbackSnapshot(page) {
  return page.locator(lessonRoot).evaluate((root) => ({
    id: root.dataset.sessionId,
    generation: Number(root.dataset.generation),
    played: Number(root.dataset.playedStep),
    action: root.dataset.playedAction,
    page: root.querySelector('[data-board-page]')?.dataset.boardPage,
    cards: [...root.querySelectorAll('[data-board-card]')].map((card) => card.dataset.boardCard),
  }));
}

async function pause(page) {
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).waitFor({ state: 'visible' });
}

async function step(page) {
  const before = (await playbackSnapshot(page)).played;
  await page.getByRole('button', { name: '单拍前进 Step', exact: true }).click();
  await page.waitForFunction(
    (before) => Number(document.querySelector('[data-session-id]')?.dataset.playedStep) > before,
    before,
  );
  return playbackSnapshot(page);
}

async function stepToAsk(page) {
  for (let n = 0; n < 20; n++) {
    if (await page.locator(askCard).isVisible()) return;
    await step(page);
  }
  assert.fail('The classroom never reached the expected ask');
}

async function answer(page, text) {
  await page.getByRole('textbox', { name: '写下你的回答' }).fill(text);
  await page.getByRole('button', { name: '提交回答' }).click();
  await page.locator(askCard).waitFor({ state: 'hidden' });
  await pause(page);
}

async function studentView(page) {
  assert.equal(
    await page.getByRole('switch', { name: 'Agent X-Ray' }).getAttribute('aria-checked'),
    'false',
  );
  assert.equal(await page.getByRole('dialog', { name: 'Agent X-Ray' }).count(), 0);
  assert.equal(
    await page.locator('[data-evidence-link], [data-state-to], [data-public-turn]').count(),
    0,
  );
  assert.doesNotMatch(
    (await page.locator('body').textContent()) ?? '',
    /TeachingState|e1-binary-v3|动作队列|公开对话 ·/,
  );
}

async function intake(page, url) {
  await page.goto(url);
  await page.getByLabel('学习主题').fill('线性插值');
  await page.getByRole('button', { name: '开始轻调研' }).click();
  await page.getByText('轻调研 · 第 1 / 2 步').waitFor();
  await page.getByText('我是初学者', { exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByText('轻调研 · 第 2 / 2 步').waitFor();
  await page.getByText('弄懂核心概念', { exact: true }).click();
  await page.getByRole('button', { name: '生成课程蓝图' }).click();
  await page
    .getByRole('heading', { name: /线性插值/ })
    .first()
    .waitFor();
  await page.getByText('学到这里时生成').first().waitFor();
  await page.getByRole('link', { name: '进入白板' }).first().click();
  await page.locator(lessonRoot).waitFor();
}

test('M1 browser: replay, learner inputs, persistence, X-Ray scoring and cross-page evidence', {
  timeout: 70_000,
}, async (t) => {
  const { page, url, errors } = await startBrowserFixture(t, { useNpmDev });
  await page.goto(url);
  await page.getByRole('link', { name: 'Eduharness课堂', exact: true }).waitFor();
  await page.getByRole('button', { name: '开始示范课：条件概率与贝叶斯直觉' }).click();
  await page.locator('[data-board-card="alarm-setup"]').waitFor();
  await studentView(page);
  await pause(page);
  const paused = (await playbackSnapshot(page)).played;
  await delay(1_100); // Longer than an autoplay beat; no additional frames may appear while paused.
  assert.equal((await playbackSnapshot(page)).played, paused);
  assert.equal((await step(page)).played, paused + 1);
  await stepToAsk(page);
  assert.equal((await playbackSnapshot(page)).page, 'opening');
  await page.locator('[data-graph="true"]').waitFor();
  await answer(page, '我会看琥珀色，因为分子是贴标且报警的 8 件，分母是 8+18 件报警包裹。');
  await stepToAsk(page);
  await page.locator('[data-board-card="bayes-rule"] .katex').waitFor();
  await answer(page, '不一定，因为两道题的分母分别是报警组和贴标组。');
  await stepToAsk(page);
  assert.equal((await playbackSnapshot(page)).page, 'base-rate');
  await page.getByRole('button', { name: '上一页' }).click();
  assert.equal((await playbackSnapshot(page)).page, 'opening');
  await page.getByRole('button', { name: '下一页' }).click();
  assert.equal((await playbackSnapshot(page)).page, 'base-rate');
  await answer(page, '我用 16 除以 32 得一半，因为报警组里两种包裹各有 16 件。');

  const cut = await playbackSnapshot(page);
  await page.getByRole('textbox', { name: '打断插话' }).fill('这一步为什么？能换个角度讲吗？');
  await page.getByRole('button', { name: '插话', exact: true }).click();
  await page.waitForFunction(
    ({ generation }) =>
      Number(document.querySelector('[data-session-id]')?.dataset.generation) === generation + 1,
    cut,
  );
  assert.equal((await playbackSnapshot(page)).played, cut.played);
  const continuation = await step(page);
  assert.ok(continuation.played > cut.played + 1);
  assert.equal(continuation.action, 'speak');
  assert.equal((await step(page)).action, 'board');
  await page.getByRole('heading', { name: /换个角度/ }).waitFor();
  assert.equal(await page.locator('[data-board-card="base-rate-answer"]').count(), 0);

  const before = await playbackSnapshot(page);
  await page.reload();
  await page.waitForFunction(({ id, generation }) => {
    const data = document.querySelector('[data-session-id]')?.dataset;
    return data?.sessionId === id && Number(data.generation) === generation + 1;
  }, before);
  assert.deepEqual(await playbackSnapshot(page), { ...before, generation: before.generation + 1 });
  await studentView(page);
  await screenshot(page, '01-xray-off.png');

  const offCard = await page.locator('[data-board-card="changed-base-rate"]').boundingBox();
  await page.getByRole('switch', { name: 'Agent X-Ray' }).click();
  const drawer = page.getByRole('dialog', { name: 'Agent X-Ray' });
  await drawer.getByText('TeachingState 真实跃迁').waitFor();
  await drawer.getByText(/截断 [1-9]\d* 步/).waitFor();
  await drawer.locator('[data-state-to="verify"]').first().waitFor();
  assert.equal(await drawer.locator('[data-state-to="completed"]').count(), 0);
  assert.ok((await drawer.locator('[data-state-to="diagnose"]').count()) > 1);
  const panel = await drawer.boundingBox();
  const onCard = await page.locator('[data-board-card="changed-base-rate"]').boundingBox();
  assert.ok(panel && onCard && offCard);
  const ratio = panel.width / page.viewportSize().width;
  assert.ok(ratio >= 0.25 && ratio <= 0.3);
  assert.ok(onCard.width >= 300 && onCard.width < offCard.width);
  assert.ok(onCard.x + onCard.width <= panel.x + 1);
  console.log(
    `M1 layout: drawer ${(ratio * 100).toFixed(1)}%, page-2 card ${offCard.width.toFixed(0)}px → ${onCard.width.toFixed(0)}px`,
  );
  await screenshot(page, '02-xray-on-actions.png');

  await drawer.getByRole('tab', { name: '公开对话投影与追踪' }).click();
  await drawer.getByText('生成打断续讲').waitFor();
  await drawer
    .locator('[data-public-turn="1"]')
    .getByRole('button', { name: '#1', exact: true })
    .waitFor();
  await screenshot(page, '03-dialogue-trace.png');
  await drawer.getByRole('tab', { name: 'eduharness 6 维质检' }).click();
  await screenshot(page, '04-quality-tab.png');
  async function runQuality() {
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith('/quality') && res.request().method() === 'POST',
      ),
      drawer.getByRole('button', { name: '运行离线质检' }).click(),
    ]);
    assert.equal(response.status(), 200);
    return response.json();
  }
  const result = await runQuality();
  assert.deepEqual(await runQuality(), result);
  const expectedScores = {
    misconception_repair: 'N/A',
    support_escalation_and_fading: 1,
    agency_handoff: 1,
    productive_struggle: 0,
    representation_pivot: 1,
    verification_or_transfer: 2,
  };
  assert.equal(result.ruler, 'e1-binary-v3');
  assert.deepEqual(result.scoring.scores, expectedScores);
  assert.deepEqual([result.scoring.points, result.scoring.possible], [5, 10]);
  assert.equal(await drawer.locator('[data-quality-dimension]').count(), 6);
  for (const [dimension, score] of Object.entries(expectedScores)) {
    await drawer
      .locator(`[data-quality-dimension="${dimension}"]`)
      .getByText(score === 'N/A' ? score : `${score} / 2`, { exact: true })
      .waitFor();
  }
  const { turns } = result.dialogue;
  assert.ok(turns.length < before.played);
  for (const [index, turn] of turns.entries()) {
    assert.equal(turn.turnNumber, index + 1);
    assert.notEqual(turn.role, turns[index - 1]?.role);
  }
  assert.ok(turns[0].evidenceStepIds.length > 3);
  assert.ok(turns.some(({ interrupted }) => interrupted));
  console.log(
    `M1 public dialogue:\n${turns.map(({ turnNumber, role, text, evidenceStepIds: ids }) => `#${turnNumber} ${role} steps ${ids[0]}–${ids.at(-1)} [${ids.join(',')}]: ${text}`).join('\n')}`,
  );
  console.log(`M1 quality identical on 2 runs: ${JSON.stringify(result.scoring)}`);
  console.log(`M1 e1-binary-v3 question evidence: ${JSON.stringify(result.answers)}`);
  await screenshot(page, '05-quality-results.png');
  await drawer.getByText('19 题明细 · 0 / 1 与证据', { exact: true }).click();
  assert.equal(await drawer.locator('[data-quality-question]').count(), 19);
  for (const [id, { score, evidence }] of Object.entries(result.answers)) {
    const row = drawer.locator(`[data-quality-question="${id}"]`);
    assert.equal(await row.locator(`[data-question-score="${score}"]`).count(), 1);
    assert.deepEqual(
      await row.locator('[data-evidence-link]').allTextContents(),
      [...new Set(Object.values(evidence ?? {}))].sort((a, b) => a - b).map((n) => `[#${n}]`),
    );
  }
  const desktop = page.viewportSize();
  await page.setViewportSize({ ...desktop, height: 1320 });
  const detailsVisible = await drawer.getByRole('list', { name: '19 题判定' }).evaluate((list) => {
    const area = list.getBoundingClientRect();
    const panel = list.closest('[role="tabpanel"]').getBoundingClientRect();
    return area.top >= panel.top && area.bottom <= panel.bottom;
  });
  assert.ok(detailsVisible, 'The capture must show all 19 rows at once');
  await screenshot(page, '05b-quality-details.png');
  await page.setViewportSize(desktop);

  assert.equal((await playbackSnapshot(page)).page, 'base-rate');
  await drawer.getByRole('button', { name: '[#1]', exact: true }).first().click();
  const card = page.locator(
    '[data-board-page="opening"] [data-board-card="alarm-setup"][data-evidence-selected="true"]',
  );
  const caption = page.locator('[data-caption-evidence="true"]');
  await card.waitFor();
  await caption.getByText(/先猜一下/).waitFor();
  assert.ok(
    await card.evaluate((card) => {
      const value = card.getBoundingClientRect();
      const clip = card.closest('[data-lesson-stage]').getBoundingClientRect();
      return value.top >= clip.top - 1 && value.bottom <= clip.bottom + 1;
    }),
  );
  const captionRect = await caption.boundingBox();
  assert.ok(captionRect && captionRect.y + captionRect.height <= page.viewportSize().height);
  console.log(
    'M1 evidence [#1]: base-rate → opening; card alarm-setup and original subtitle highlighted and in view',
  );
  await screenshot(page, '06-cross-page-evidence.png');
  await page.getByRole('button', { name: '课堂记录', exact: true }).click();
  const records = page.getByRole('dialog', { name: '课堂记录' });
  await records
    .locator('[data-record-kind="subtitle"][data-evidence-selected="true"]')
    .getByText(/先猜一下/)
    .waitFor();
  await records.getByText('这一步为什么？能换个角度讲吗？').waitFor();
  await screenshot(page, '07-record-evidence.png');
  await records.getByRole('button', { name: '收起抽屉' }).click();

  await page.getByRole('button', { name: '下一页' }).click();
  assert.equal((await playbackSnapshot(page)).page, 'base-rate');
  await page.getByRole('button', { name: '课堂记录', exact: true }).click();
  const oldSubtitle = records
    .locator('[data-record-kind="subtitle"]')
    .filter({ hasText: '检验的方法是读条件线右侧' });
  await oldSubtitle.getByRole('button', { name: '#5', exact: true }).click();
  await records.getByRole('button', { name: '收起抽屉' }).click();
  assert.equal((await playbackSnapshot(page)).page, 'opening');
  await page.locator('[data-board-card="bayes-rule"][data-evidence-selected="true"]').waitFor();
  await caption.getByText(/检验的方法是读条件线右侧/).waitFor();
  // Restore the automatic latest page preference before the X-Ray-off assertion.
  await page.getByRole('button', { name: '下一页' }).click();
  console.log(
    'M1 record evidence [#5]/step 17: a multi-page turn returns to the clicked subtitle’s own page',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await drawer.getByRole('button', { name: '[#1]', exact: true }).first().click();
  const narrowScroll = await card.getByRole('heading').evaluate((heading) => {
    const stage = heading.closest('[data-lesson-stage]');
    const clip = stage.getBoundingClientRect();
    const bounds = heading.getBoundingClientRect();
    return {
      scrollTop: stage.scrollTop,
      visible: bounds.top >= clip.top && bounds.bottom <= clip.bottom,
    };
  });
  assert.ok(narrowScroll.scrollTop > 0 && narrowScroll.visible, JSON.stringify(narrowScroll));
  await drawer.getByRole('tab', { name: '动作流与状态机' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  const narrowDrawer = await drawer.boundingBox();
  assert.ok(narrowDrawer.y > 380 && narrowDrawer.y + narrowDrawer.height <= 845);
  assert.ok((await page.locator('[data-board-card="alarm-setup"]').boundingBox()).width >= 300);
  console.log(
    `M1 narrow evidence: board scrollTop=${narrowScroll.scrollTop}px; card title in view`,
  );
  await screenshot(page, '08-xray-narrow.png');
  await page.getByRole('switch', { name: 'Agent X-Ray' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await studentView(page);
  assert.equal((await playbackSnapshot(page)).page, 'base-rate');
  await screenshot(page, '09-xray-off-restored.png');

  await page.getByRole('button', { name: '重新开始本课' }).click();
  await page.waitForFunction((id) => {
    const active = document.querySelector('[data-session-id]')?.dataset.sessionId;
    return active && active !== id;
  }, before.id);
  assert.equal((await playbackSnapshot(page)).page, 'opening');
  await intake(page, url);
  console.log(
    'M1 regression: demo entry, two-step intake, pause, single-step, ask, pagination, KaTeX, interrupt, reload, restart',
  );
  console.log(`M1 browser console/page errors (${errors.length}): ${JSON.stringify(errors)}`);
  assert.deepEqual(errors, []);
});
