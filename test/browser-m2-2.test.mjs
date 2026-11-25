import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startBrowserFixture } from './browser-fixture.mjs';

const screenshotDir = process.env.STUDIO_TEACHER_SCREENSHOTS;
const classroom = '[data-session-id]';
const askCard = '[data-ask-card]';

async function screenshot(page, name) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  const path = join(screenshotDir, name);
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`M2-2 faux screenshot: ${path}`);
}

async function pause(page) {
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).waitFor();
}

async function step(page) {
  const played = Number(await page.locator(classroom).getAttribute('data-played-step'));
  await page.getByRole('button', { name: '单拍前进 Step', exact: true }).click();
  await page.waitForFunction(
    (before) => Number(document.querySelector('[data-session-id]')?.dataset.playedStep) > before,
    played,
  );
}

async function handoff(page, question) {
  for (let n = 0; n < 8 && !(await page.locator(askCard).isVisible()); n += 1) await step(page);
  await page.locator(askCard).getByText(question, { exact: true }).waitFor();
}

async function stepToPanel(page, title) {
  const panel = page.getByRole('heading', { name: title, exact: true });
  for (let n = 0; n < 12 && !(await panel.isVisible()); n++) await step(page);
  await panel.waitFor();
  return panel;
}

async function customAnswer(page, text) {
  await page.getByRole('textbox', { name: '写下你的回答' }).fill(text);
  await page.getByRole('button', { name: '提交回答' }).click();
  await page.locator(askCard).waitFor({ state: 'hidden' });
  await pause(page);
}

async function read(page, url) {
  const response = await page.request.get(url);
  assert.equal(response.status(), 200);
  return response.json();
}

async function enableFaux(page) {
  await page.getByRole('button', { name: /离线确定性模式.*BYOK/ }).click();
  const dialog = page.getByRole('dialog', { name: /模型与自带密钥/ });
  await dialog.getByLabel('供应商').selectOption('faux');
  await dialog.getByLabel('模型', { exact: true }).selectOption('faux-1');
  await dialog.getByLabel('临时 API Key').fill('faux-browser-test-only');
  await dialog.getByRole('button', { name: '保存配置' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /在线模型已配置.*BYOK/ }).waitFor();
}

test('M2-2 Chromium faux: choice, transfer mastery, prerequisite restore, low effort, interruption and X-Ray', {
  timeout: 70_000,
}, async (t) => {
  const { page, url, errors, logs, databaseFiles } = await startBrowserFixture(t, {
    serverEntry: 'test/faux-m2-server.mjs',
  });
  const external = [];
  await page.route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === url) return route.continue();
    external.push(origin);
    return route.abort();
  });
  await page.goto(url);
  await enableFaux(page);
  const generated = await page.request.post(`${url}/api/intake/generate`, {
    data: { topic: '奇偶性与配对', foundation: 'experienced', goal: 'understand' },
  });
  assert.equal(generated.status(), 201);
  const course = await generated.json();
  const lessonPath = `/courses/${course.id}/lessons/${course.units[0].lessons[0].id}`;
  const activePath = `${url}/api${lessonPath}/sessions/active`;
  const [started] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url() === `${url}/api${lessonPath}/sessions` && res.request().method() === 'POST',
    ),
    page.goto(`${url}${lessonPath}`),
  ]);
  assert.equal(started.status(), 201, `faux opening: ${await started.text()}\n${logs()}`);
  await page.getByRole('heading', { name: '小物件如何配对' }).waitFor();
  await pause(page);
  await handoff(page, '五块积木每两块一组，最后会怎样？');
  const firstChoice = page.locator(askCard);
  await firstChoice.getByRole('button', { name: '四块成两对，还剩一块' }).waitFor();
  await screenshot(page, '01-diagnostic-choice.png');
  await firstChoice.getByRole('button', { name: '四块成两对，还剩一块' }).click();
  await firstChoice.waitFor({ state: 'hidden' });
  await pause(page);
  await handoff(page, '七块积木两两配对，会剩下几块？');
  assert.equal(await page.locator('[data-completed-keypoint]').count(), 0);
  const transfer = await read(page, activePath);
  const current = transfer.keypoints.find(({ status }) => status === 'active');
  const following = transfer.keypoints.find(({ status }) => status === 'pending');
  assert.ok(current && following);
  assert.equal(transfer.playedActions.at(-1).checkpoint, 'verify');
  assert.ok(
    transfer.records.some(({ kind, text }) => kind === 'answer' && text === '四块成两对，还剩一块'),
  );
  await customAnswer(page, '七块能配成三对，还剩下一块。');
  await handoff(page, '两组的配对结果有什么不同？');
  await page.locator(`[data-completed-keypoint="${current.id}"]`).waitFor();
  const mastered = await read(page, activePath);
  const completion = mastered.playedActions.findIndex(({ type }) => type === 'keypoint_complete');
  assert.ok(completion > 0);
  assert.equal(mastered.playedActions[completion - 1].type, 'speak');
  assert.equal(mastered.playedActions[completion - 1].checkpoint, 'verify');
  assert.equal(mastered.playedActions[completion].keypoint_id, current.id);
  assert.equal(
    mastered.playedActions[completion].summary,
    '按两块一对分组后，还有一块找不到伙伴。',
  );
  assert.equal(
    mastered.records.filter(
      ({ kind, text }) => kind === 'answer' && text === '七块能配成三对，还剩下一块。',
    ).length,
    1,
  );
  await screenshot(page, '02-verified-transfer.png');

  await customAnswer(page, '我卡住了，前置知识不懂。');
  await handoff(page, '四块积木可以分成几对？');
  const inserted = await read(page, activePath);
  assert.deepEqual(
    inserted.keypoints.map(({ id }) => id),
    [current.id, 'pre-groups', following.id],
  );
  await page.reload();
  await page.locator(askCard).getByText('四块积木可以分成几对？', { exact: true }).waitFor();
  await page
    .getByRole('navigation', { name: '本课要点进度' })
    .getByText('两两配对', { exact: true })
    .waitFor();
  const restored = await read(page, activePath);
  assert.equal(restored.session_id, inserted.session_id);
  assert.equal(restored.generation, inserted.generation + 1);
  assert.deepEqual(restored.keypoints, inserted.keypoints);
  await screenshot(page, '03-prerequisite-after-reload.png');

  await customAnswer(page, '1');
  await handoff(page, '桌上这两块能不能摆成一对？');
  const downgrade = page.locator(askCard);
  assert.equal(await downgrade.locator('fieldset button').count(), 2);
  assert.equal(
    await page
      .locator('[data-unverified-keypoint], [data-completed-keypoint="pre-groups"]')
      .count(),
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await screenshot(page, '04-low-effort-choice-mobile.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await customAnswer(page, '继续');
  assert.equal(await page.locator('[data-unverified-keypoint="pre-groups"]').count(), 0);
  const queuedTrace = await read(page, `${url}/api/sessions/${restored.session_id}/xray`);
  const queuedSkip = queuedTrace.teacherTurns.find(({ unverified }) => unverified === 'pre-groups');
  assert.ok(queuedSkip?.unverifiedStepId);
  assert.equal(queuedTrace.playedStepIds.includes(queuedSkip.unverifiedStepId), false);
  await page.getByRole('switch', { name: 'Agent X-Ray' }).click();
  const queuedDrawer = page.getByRole('dialog', { name: 'Agent X-Ray' });
  await queuedDrawer.getByRole('tab', { name: '公开对话投影与追踪' }).click();
  await queuedDrawer.getByText('待上屏的未验证标记').waitFor();
  await page.getByRole('switch', { name: 'Agent X-Ray' }).click();
  await stepToPanel(page, '换个数继续观察');
  await page.locator('[data-unverified-keypoint="pre-groups"]').waitFor();
  assert.equal(await page.locator('[data-completed-keypoint="pre-groups"]').count(), 0);
  const played = Number(await page.locator(classroom).getAttribute('data-played-step'));
  const generation = Number(await page.locator(classroom).getAttribute('data-generation'));
  const xrayPath = `${url}/api/sessions/${restored.session_id}/xray`;
  const traceBeforeInterrupt = await read(page, xrayPath);
  const cut = traceBeforeInterrupt.queued;
  const cutIDs = cut.map(({ step_id }) => step_id);
  assert.ok(cut.some(({ type }) => type === 'board'));
  assert.equal(await page.getByRole('heading', { name: '六块积木的另一种排法' }).count(), 0);
  assert.equal(cut.at(-1).type, 'ask');
  await page.getByRole('textbox', { name: '打断插话' }).fill('换个角度接着讲。');
  await page.getByRole('button', { name: '插话', exact: true }).click();
  await page.waitForFunction(
    (old) => Number(document.querySelector('[data-session-id]')?.dataset.generation) === old + 1,
    generation,
  );
  const afterInterrupt = await read(page, activePath);
  const interruption = afterInterrupt.records.at(-1);
  assert.equal(interruption.kind, 'interrupt');
  assert.equal(interruption.last_played_step_id, played);
  assert.equal(afterInterrupt.last_played_step_id, played);
  assert.deepEqual(interruption.truncated_step_ids, cutIDs);
  const continuation = await stepToPanel(page, '沿用桌上的积木');
  await continuation.scrollIntoViewIfNeeded();
  assert.ok(
    Number(await page.locator(classroom).getAttribute('data-played-step')) > Math.max(...cutIDs),
  );
  assert.equal(await page.getByText('教师回合 · 认知诊断').count(), 0);
  await screenshot(page, '05-interrupted-resume.png');

  await page.getByRole('switch', { name: 'Agent X-Ray' }).click();
  const drawer = page.getByRole('dialog', { name: 'Agent X-Ray' });
  await drawer.getByRole('tab', { name: '公开对话投影与追踪' }).click();
  await drawer.getByText('mastered', { exact: true }).waitFor();
  await drawer.getByText('missing_prereq', { exact: true }).waitFor();
  await drawer.getByText('low_effort', { exact: true }).first().waitFor();
  await drawer.getByText('护栏拦截与重试', { exact: true }).waitFor();
  await screenshot(page, '06-xray-diagnosis-and-guardrails.png');
  await drawer.locator('[data-span-kind="model"]').first().waitFor();
  await drawer.locator('[data-span-kind="tool"]').first().scrollIntoViewIfNeeded();
  const trace = await read(page, xrayPath);
  assert.ok(trace.teacherTurns.some(({ inserted }) => inserted?.id === 'pre-groups'));
  assert.ok(trace.teacherTurns.some(({ unverified }) => unverified === 'pre-groups'));
  assert.ok(
    trace.teacherTurns.some(
      ({ diagnosis, guardrails }) =>
        diagnosis?.status === 'mastered' &&
        guardrails.some(({ reasons }) =>
          reasons.some((reason) =>
            reason.includes('$.resolution.conclusion: missing required field'),
          ),
        ),
    ),
  );
  const toolSpans = trace.spans.filter(({ kind }) => kind === 'tool');
  assert.equal(toolSpans.length, 2);
  assert.deepEqual(
    toolSpans.map(({ name, input }) => [name, input.amount]),
    [
      ['mock_calc', 2],
      ['mock_calc', 3],
    ],
  );
  assert.deepEqual(
    toolSpans.map(({ result }) => result.sum),
    [4, 6],
  );
  assert.ok(trace.spans.every(({ durationMs }) => Number.isFinite(durationMs) && durationMs >= 0));
  await screenshot(page, '07-xray-model-and-tool-spans.png');

  const secrets = ['faux-browser-test-only', 'fake-tool-input-secret', 'fake-tool-result-secret'];
  const files = databaseFiles();
  assert.ok(files['studio.sqlite']?.length > 0);
  for (const secret of secrets) {
    assert.equal(JSON.stringify(trace).includes(secret), false);
    assert.equal(logs().includes(secret), false);
    for (const bytes of Object.values(files)) assert.equal(bytes.includes(secret), false);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    'M2-2 faux browser verified master/verify, insertion and refresh, both low effort paths, monotonic interruption, and diagnostic/tool trace.',
  );
});
