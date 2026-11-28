import assert from 'node:assert/strict';
import { errors } from 'playwright';
import { SceneStop } from './scene-stop.mjs';

const beatLimit = 70;
const classroom = '[data-session-id]';
const ask = '[data-ask-card]';
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function waitFor(work, reason) {
  try {
    return await work;
  } catch (error) {
    if (error instanceof errors.TimeoutError) throw new SceneStop('no_handoff', reason);
    throw error;
  }
}

export async function holdFirstProgress(page, url) {
  // ACK gates delivery of the second beat. Hold the first real UI write just long enough
  // to pause after its DOM commit, rather than racing the teacher's playback cadence.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    `${url}/api/sessions/*/progress`,
    async (route) => {
      await held;
      // This exact same-origin route is already covered by the browser allowlist.
      await route.continue();
    },
    { times: 1 },
  );
  return release;
}

async function interruptFirstBeat({ page, snapshot, trace, mutate, release, student, signal }) {
  await waitFor(
    page.locator(`${classroom}[data-played-step="1"]`).waitFor(),
    'first_beat_not_visible',
  );
  const resumed = button(page, '继续');
  await waitFor(button(page, '暂停').click(), 'no_interrupt_window');
  await resumed.waitFor();
  const ack = page.waitForResponse(
    (res) => res.url().endsWith('/progress') && res.request().method() === 'POST',
  );
  release();
  assert.equal((await ack).status(), 200);
  const onScreen = await snapshot();
  const step = onScreen.last_played_step_id;
  assert.equal(step, 1);
  assert.equal(onScreen.playedActions.length, 1);
  // Generate from the acknowledged public view before reading the unplayed queue.
  const text = await student('interrupt', onScreen, signal);
  const before = await trace();
  const queued = before.queued.map(({ step_id }) => step_id);
  assert.equal(before.last_played_step_id, step);
  assert.ok(queued.length > 0 && queued.every((id) => id > step), 'No pending beats to cut');
  await page.getByRole('textbox', { name: '打断插话' }).fill(text);
  const res = await mutate('interrupt', () => button(page, '插话').click());
  const updated = await res.json();
  const record = updated.records.at(-1);
  assert.equal(record.kind, 'interrupt');
  assert.ok(record.text === text, 'Interrupt receipt did not preserve the student input');
  assert.equal(record.last_played_step_id, step);
  assert.equal(updated.last_played_step_id, step);
  assert.equal(updated.generation, before.generation + 1);
  assert.deepEqual(record.truncated_step_ids, queued);
  await page.locator(`${classroom}[data-generation="${updated.generation}"]`).waitFor();
  await resumed.click();
  return { step, queued };
}

async function waitForDecision(page, snapshot, previousStep) {
  const scope = `${classroom}:not([data-played-step="${previousStep}"]) ${ask}`;
  const answer = page.locator(`${scope} textarea:enabled`);
  const complete = page.getByText('本课演播完成', { exact: true });
  await waitFor(answer.or(complete).first().waitFor({ timeout: 60_000 }), 'no_playback_decision');
  const current = await snapshot();
  const step = current.last_played_step_id;
  assert.ok(step > previousStep, 'Live playback cursor did not advance');
  if (await complete.isVisible()) {
    assert.equal(current.state, 'completed');
  } else {
    assert.equal(current.state, 'handoff');
    assert.equal(current.askStep, step);
    assert.ok(
      current.playedActions.at(-1)?.prompt ===
        (await page.locator(`${scope} #ask-prompt`).textContent()),
      'Student question differed from the acknowledged visible prompt',
    );
  }
  return current;
}

function assertCompleted(snapshot, trace, checkpoints, cut) {
  assert.equal(snapshot.askStep, null);
  assert.equal(trace.transitions.at(-1)?.to, 'completed');
  assert.equal(trace.last_played_step_id, snapshot.last_played_step_id);
  assert.ok(snapshot.keypoints.every(({ status }) => ['completed', 'unverified'].includes(status)));
  const played = snapshot.playedActions.map(({ step_id }) => step_id);
  assert.deepEqual(trace.playedStepIds, played);
  assert.ok(played.every((id, index) => id > (played[index - 1] ?? 0)));
  const interactions = snapshot.records.flatMap((record) => {
    if (record.kind === 'answer') return [{ kind: record.kind, step: record.ask_step_id }];
    if (record.kind === 'interrupt')
      return [{ kind: record.kind, step: record.last_played_step_id }];
    return [];
  });
  assert.deepEqual(
    interactions,
    checkpoints.map(({ kind, step }) => ({ kind, step })),
  );
  if (cut) {
    assert.ok(
      cut.queued.every((id) => !played.includes(id)),
      'Cut beats reached playback',
    );
    cut.resumed = played.find((id) => id > cut.step);
    assert.ok(cut.resumed > Math.max(...cut.queued), 'Continuation reused a cut step id');
  }
}

export async function playLiveLesson(controls, phases) {
  const { page, student, signal, snapshot, trace, mutate } = controls;
  const checkpoints = [];
  let cut;
  let step = 0;
  if (phases[0] === 'interrupt') {
    cut = await interruptFirstBeat(controls);
    step = cut.step;
    checkpoints.push({ step, phase: 'interrupt', kind: 'interrupt' });
  }
  for (;;) {
    signal.throwIfAborted();
    const current = await waitForDecision(page, snapshot, step);
    const beats = current.playedActions.length;
    assert.ok(beats <= beatLimit, 'Live playback exceeded 70 acknowledged beats');
    if (current.state === 'completed') {
      assertCompleted(current, await trace(), checkpoints, cut);
      return { snapshot: current, cut, checkpoints, beats };
    }
    if (beats === beatLimit) throw new SceneStop('step_limit', 'lesson_beat_limit');
    step = current.last_played_step_id;
    const phase = phases[checkpoints.length] ?? 'follow';
    const text = await student(phase, current, signal);
    await page.getByRole('textbox', { name: '写下你的回答' }).fill(text);
    const response = await mutate('answer', () => button(page, '提交回答').click());
    const { record } = await response.json();
    assert.equal(record?.kind, 'answer');
    assert.equal(record.ask_step_id, step);
    assert.ok(record.text === text, 'Answer receipt did not preserve the student input');
    checkpoints.push({ step, phase, kind: 'answer' });
  }
}
