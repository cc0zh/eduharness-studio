import assert from 'node:assert/strict';
import { join } from 'node:path';
import { holdFirstProgress, playLiveLesson } from './play-live-scene.mjs';
import { SceneStop } from './scene-stop.mjs';

const classroom = '[data-session-id]';
const ask = '[data-ask-card]';
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function afterModelAction(page, action, matches, stage) {
  const [response] = await Promise.all([page.waitForResponse(matches), action()]);
  if (response.status() === 502) throw new SceneStop('no_handoff', stage, response.url());
  assert.ok(response.ok(), `Unexpected HTTP ${response.status()} during ${stage}`);
  return response;
}

async function enter(page, url, topic, isFaux) {
  await page.goto(url);
  await page.getByRole('button', { name: /在线模型已配置.*BYOK/ }).waitFor();
  await page.getByLabel('学习主题').fill(topic);
  await button(page, '开始轻调研').click();
  await page.getByText('我是初学者', { exact: true }).click();
  await button(page, '下一步').click();
  await page.getByText('弄懂核心概念', { exact: true }).click();
  const generate = () => button(page, '生成课程蓝图').click();
  if (isFaux) await generate();
  else {
    page.setDefaultTimeout(100_000);
    await afterModelAction(
      page,
      generate,
      (res) => res.url() === `${url}/api/intake/generate` && res.request().method() === 'POST',
      'course_generation_failed',
    );
  }
  const entry = page.getByRole('link', { name: '进入白板', exact: true }).first();
  const path = await entry.getAttribute('href');
  assert.match(path, /\/lessons\/u1-l1$/);
  if (isFaux) await entry.click();
  else {
    const lessonUrl = `${url}/api${path}`;
    await afterModelAction(
      page,
      () => entry.click(),
      (res) =>
        (res.url() === lessonUrl && res.request().method() === 'GET' && !res.ok()) ||
        (res.url() === `${lessonUrl}/sessions` && res.request().method() === 'POST'),
      'lesson_generation_failed',
    );
  }
  const { sessionId } = await page.locator(classroom).evaluate((node) => ({ ...node.dataset }));
  assert.ok(sessionId);
  return { path, sessionId };
}

async function read(page, url) {
  const response = await page.request.get(url, { timeout: 5_000, maxRedirects: 0 });
  assert.equal(response.status(), 200);
  return response.json();
}

async function handoff(page, activePath, expected) {
  const prompt = page.locator(`${ask} #ask-prompt`);
  await prompt.waitFor({ timeout: 35_000 });
  if (expected) assert.equal(await prompt.textContent(), expected);
  await page.locator(`${ask} textarea:enabled`).waitFor();
  const snapshot = await read(page, activePath);
  assert.equal(snapshot.state, 'handoff');
  assert.equal(snapshot.askStep, snapshot.last_played_step_id);
  assert.equal(snapshot.playedActions.at(-1).prompt, await prompt.textContent());
  return snapshot;
}

async function advanceBeat(page) {
  const before = Number(await page.locator(classroom).getAttribute('data-played-step'));
  await button(page, '单拍前进 Step').click();
  await page.waitForFunction(
    (last) =>
      Number(document.querySelector('[data-session-id]')?.getAttribute('data-played-step')) > last,
    before,
  );
}

async function interrupt({ page, tracePath, activePath, input, cut }) {
  // Wait for the player, pause it, then ensure the visible cursor has reached its ACK.
  await button(page, '暂停').click();
  if (!(await page.locator(`${classroom}[data-played-step]:not([data-played-step="0"])`).count()))
    await advanceBeat(page);
  await page.getByRole('heading', { name: cut.anchor, exact: true }).waitFor();
  const step = Number(await page.locator(classroom).getAttribute('data-played-step'));
  await page.waitForFunction(
    async ({ url, step }) => {
      const response = await fetch(url, { cache: 'no-store' });
      return (await response.json()).last_played_step_id === step;
    },
    { url: tracePath, step },
  );
  const before = await read(page, tracePath);
  const queued = before.queued.map(({ step_id }) => step_id);
  assert.ok(step > 0 && queued.length > 0 && queued.every((id) => id > step));
  assert.ok(before.queued.some(({ type }) => type === 'board'));
  assert.equal(await page.getByRole('heading', { name: cut.unplayed, exact: true }).count(), 0);
  await page.getByRole('textbox', { name: '打断插话' }).fill(input);
  const submit = () => button(page, '插话').click();
  const matches = (res) => res.url() === tracePath.replace(/\/xray$/, '/interrupt');
  const [response] = await Promise.all([page.waitForResponse(matches), submit()]);
  assert.equal(response.status(), 200);
  const updated = await response.json();
  const record = updated.records.at(-1);
  assert.equal(record.kind, 'interrupt');
  assert.equal(record.text, input);
  assert.equal(record.last_played_step_id, step);
  assert.equal(updated.last_played_step_id, step);
  assert.deepEqual(record.truncated_step_ids, queued);
  await page.locator(`${classroom}[data-generation="${before.generation + 1}"]`).waitFor();
  for (let n = 0; n < 20 && !(await page.locator(ask).isVisible()); n++) await advanceBeat(page);
  const snapshot = await handoff(page, activePath);
  const continued = snapshot.playedActions.filter(({ step_id }) => step_id > step);
  assert.ok(
    continued.length > 0 && continued.every(({ step_id }) => step_id > Math.max(...queued)),
  );
  assert.ok(continued.some(({ type, title }) => type === 'board' && title === cut.reply));
  return { snapshot, cut: { step, queued, resumed: continued[0].step_id } };
}

function assertTurn(snapshot, trace, turn) {
  const latest = trace.teacherTurns.at(-1);
  assert.equal(latest.outcome, 'accepted');
  assert.equal(latest.diagnosis.status, turn.output.diagnosis.status);
  const expectation = turn.expect ?? {};
  const askBeat = snapshot.playedActions.at(-1);
  assert.equal(askBeat.checkpoint, expectation.checkpoint);
  if (expectation.options) assert.equal(askBeat.options?.length, expectation.options);
  for (const [key, status] of [
    ['active', 'active'],
    ['pending', 'pending'],
    ['complete', 'completed'],
    ['unverified', 'unverified'],
  ]) {
    if (expectation[key])
      assert.equal(snapshot.keypoints.find(({ id }) => id === expectation[key])?.status, status);
  }
  if (expectation.inserted) {
    assert.equal(latest.inserted?.id, expectation.inserted);
    assert.equal(latest.inserted?.before, expectation.pending);
    assert.ok(
      snapshot.keypoints.findIndex(({ id }) => id === expectation.inserted) <
        snapshot.keypoints.findIndex(({ id }) => id === expectation.pending),
    );
  }
  if (expectation.complete) {
    const beats = snapshot.playedActions;
    const complete = beats.findIndex(
      ({ type, keypoint_id }) =>
        type === 'keypoint_complete' && keypoint_id === expectation.complete,
    );
    assert.equal(beats[complete - 1]?.checkpoint, 'verify');
    assert.equal(beats[complete].summary, turn.output.resolution.conclusion);
  }
  if (expectation.unverified) {
    assert.equal(latest.unverified, expectation.unverified);
    assert.ok(trace.playedStepIds.includes(latest.unverifiedStepId));
    assert.ok(
      !snapshot.playedActions.some(
        ({ type, keypoint_id }) =>
          type === 'keypoint_complete' && keypoint_id === expectation.unverified,
      ),
    );
  }
  if (turn.calc) {
    const span = trace.spans.find(
      ({ name, step_id }) => name === 'calc_verify' && step_id === latest.step_id,
    );
    assert.equal(span?.input.expression, turn.calc.expression);
    assert.equal(span?.result.text, turn.calc.result);
  }
}

async function playFauxLesson({ page, activePath, tracePath, shot }, scene) {
  let snapshot;
  let cut;
  const checkpoints = [];
  if (!scene.cut) snapshot = await handoff(page, activePath, scene.opening.next_ask.prompt);
  for (const [index, turn] of scene.turns.entries()) {
    if (turn.kind === 'interrupt') {
      ({ snapshot, cut } = await interrupt({
        page,
        tracePath,
        activePath,
        input: turn.input,
        cut: scene.cut,
      }));
    } else {
      await page.getByRole('textbox', { name: '写下你的回答' }).fill(turn.input);
      await button(page, '提交回答').click();
      await page.locator(ask).waitFor({ state: 'hidden' });
      snapshot = await handoff(page, activePath, turn.output.next_ask.prompt);
    }
    assert.equal(snapshot.records.filter(({ text }) => text === turn.input).length, 1);
    const trace = await read(page, tracePath);
    assert.equal(trace.last_played_step_id, snapshot.last_played_step_id);
    assertTurn(snapshot, trace, turn);
    if (turn.expect?.options)
      assert.equal(await page.locator(`${ask} fieldset button`).count(), turn.expect.options);
    if (turn.expect?.complete)
      await page.locator(`[data-completed-keypoint="${turn.expect.complete}"]`).waitFor();
    if (turn.expect?.unverified)
      await page.locator(`[data-unverified-keypoint="${turn.expect.unverified}"]`).waitFor();
    if (scene.rejectedOpening && index === 0) {
      assert.ok(
        trace.teacherTurns[0].guardrails.some(({ reasons }) =>
          reasons.some((reason) => reason.includes('reveals the answer')),
        ),
      );
      assert.ok(
        !snapshot.playedActions.some((beat) =>
          JSON.stringify(beat).includes(scene.rejectedOpening),
        ),
      );
    }
    checkpoints.push({
      step: snapshot.last_played_step_id,
      ask: snapshot.playedActions.at(-1),
      keypoints: snapshot.keypoints,
      turn: trace.teacherTurns.at(-1),
    });
    if (turn.expect?.options) await shot('binary-choice.png');
  }
  return { snapshot, cut, checkpoints };
}

async function collectProjection(page, tracePath, snapshot, cut, forbidden) {
  await page.getByRole('switch', { name: 'Agent X-Ray' }).click();
  const drawer = page.getByRole('dialog', { name: 'Agent X-Ray' });
  await drawer.getByRole('tab', { name: '公开对话投影与追踪' }).click();
  const rows = drawer.locator('[data-public-turn]');
  await rows.first().waitFor();
  const visible = await rows.evaluateAll((nodes) =>
    nodes.map((node) => ({
      number: Number(node.getAttribute('data-public-turn')),
      label: node.querySelector(':scope > div > span').textContent,
      text: node.querySelector(':scope > p').textContent,
    })),
  );
  const qualityPath = tracePath.replace(/\/xray$/, '/quality');
  const response = await page.request.post(qualityPath, {
    data: {},
    timeout: 5_000,
    maxRedirects: 0,
  });
  assert.equal(response.status(), 200);
  const quality = await response.json();
  assert.equal(quality.last_played_step_id, snapshot.last_played_step_id);
  const { turns } = quality.dialogue;
  assert.deepEqual(
    visible,
    turns.map(({ turnNumber, role, interrupted, text }) => ({
      number: turnNumber,
      label: role === 'teacher' ? '老师' : interrupted ? '学生 · 插话' : '学生',
      text,
    })),
  );
  if (cut)
    assert.ok(
      turns.every(({ evidenceStepIds }) => evidenceStepIds.every((id) => !cut.queued.includes(id))),
    );
  for (const text of forbidden) assert.ok(turns.every((turn) => !turn.text.includes(text)));
  await rows.last().scrollIntoViewIfNeeded();
  return {
    visible,
    quality: { dialogue: { turns }, last_played_step_id: quality.last_played_step_id },
  };
}

export async function playScene({ page, url }, scene, directory, { student, signal }) {
  const isFaux = !student;
  const release =
    !isFaux && scene.livePhases[0] === 'interrupt' ? await holdFirstProgress(page, url) : undefined;
  try {
    return await playAndCollect({ page, url }, scene, directory, {
      student,
      signal,
      release,
      isFaux,
    });
  } finally {
    release?.();
  }
}

async function playAndCollect(
  { page, url },
  scene,
  directory,
  { student, signal, release, isFaux },
) {
  const { path, sessionId } = await enter(page, url, scene.topic, isFaux);
  const activePath = `${url}/api${path}/sessions/active`;
  const sessionPath = `${url}/api/sessions/${sessionId}`;
  const tracePath = `${sessionPath}/xray`;
  const saves = [];
  const shot = async (name) => {
    saves.push(name);
    await page.screenshot({ path: join(directory, name), animations: 'disabled' });
  };
  const { snapshot, cut, checkpoints, beats } = isFaux
    ? await playFauxLesson({ page, activePath, tracePath, shot }, scene)
    : await playLiveLesson(
        {
          page,
          release,
          signal,
          student,
          snapshot: () => read(page, activePath),
          trace: () => read(page, tracePath),
          mutate: (kind, action) =>
            afterModelAction(
              page,
              action,
              (res) => res.url() === `${sessionPath}/${kind}` && res.request().method() === 'POST',
              `${kind}_generation_failed`,
            ),
        },
        scene.livePhases,
      );
  const forbidden = isFaux ? [scene.cut?.unplayed, scene.rejectedOpening].filter(Boolean) : [];
  const projection = await collectProjection(page, tracePath, snapshot, cut, forbidden);
  await shot('classroom-xray.png');
  return {
    sessionId,
    state: snapshot.state,
    step: snapshot.last_played_step_id,
    cut,
    checkpoints,
    ...(beats === undefined ? {} : { beats }),
    ...projection,
    screenshots: saves,
  };
}
