import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { demoCourses, offlineLesson } from '@eduharness-studio/engine';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
} from '@eduharness-studio/engine/models';
import { createTeacherPlanner } from '@eduharness-studio/engine/teacher';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';

export const opening = {
  diagnosis: { status: 'opening', summary: '先观察配对。', strategy: '摆成一行。' },
  actions: [
    { type: 'board', column: 1, card_id: 'open', content: '五块积木试着两两配对。' },
    { type: 'speak', text: '先每两块摆成一组。' },
    { type: 'highlight', card_id: 'open', target_text: '两两', style: 'circle' },
    { type: 'ask', card_id: 'open-ask', mode: 'open', prompt: '最后会剩下什么？' },
  ],
};

export const scaffold = {
  diagnosis: { status: 'low_effort', summary: '尚无判断。', strategy: '轻量点选。' },
  actions: [
    { type: 'board', column: 1, card_id: 'choice-board', content: '每组摆两块。' },
    { type: 'speak', text: '先选一个直觉判断。' },
    { type: 'highlight', card_id: 'choice-board', target_text: '两块', style: 'circle' },
    {
      type: 'ask',
      card_id: 'choice-ask',
      mode: 'choice',
      prompt: '五块会怎样？',
      options: [
        { id: 'one-left', label: '剩下一块' },
        { id: 'none', label: '没有剩余' },
      ],
    },
  ],
};

export function lowEffortScaffold() {
  return {
    diagnosis: { status: 'low_effort', summary: '尚无判断。', strategy: '改成二选一。' },
    actions: [
      { type: 'board', column: 1, card_id: 'first-low', content: '先摆两块积木。' },
      { type: 'speak', text: '先比较这两块。' },
      { type: 'highlight', card_id: 'first-low', target_text: '两块', style: 'circle' },
      {
        type: 'ask',
        card_id: 'first-low-ask',
        mode: 'choice',
        prompt: '它们能组成一对吗？',
        options: [
          { id: 'pair', label: '能组成一对' },
          { id: 'apart', label: '还不能' },
        ],
      },
    ],
  };
}

export function unverifiedTurn(keypointId: string, prefix: string) {
  return {
    diagnosis: {
      status: 'low_effort',
      summary: '连续回复仍没有显示推理。',
      strategy: '诚实记下后继续。',
    },
    actions: [
      { type: 'board', column: 1, card_id: `${prefix}-board`, content: '每一组摆两块。' },
      { type: 'speak', text: '先记住这条线索。' },
      { type: 'keypoint_unverified', keypoint_id: keypointId },
      { type: 'board', column: 2, card_id: `${prefix}-next`, content: '换成另一组数量。' },
      { type: 'ask', card_id: `${prefix}-ask`, mode: 'open', prompt: '现在可以分成几对？' },
    ],
  };
}

export function makeFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'eduharness-teacher-lock-'));
  const path = join(directory, 'studio.sqlite');
  const database = openStudioDatabase(path);
  const closeAdditional: (() => void)[] = [];
  const faux = createFauxModelGateway();
  assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-only' }));
  const planner = createTeacherPlanner(faux.gateway);
  const store = createSessionStore(database, planner);
  const course = demoCourses[0];
  const lesson = course.units[0].lessons[0];
  const script = offlineLesson(course, lesson);
  t.after(() => {
    for (const close of closeAdditional) close();
    database.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  });
  const structured = (value: unknown) =>
    fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
  const options = (restart: boolean, live = true) => ({
    courseId: course.id,
    lessonId: lesson.id,
    topic: 'odd-even pairs',
    buildScript: () => script,
    restart,
    live,
  });
  return {
    database,
    path,
    faux,
    planner,
    store,
    structured,
    options,
    course,
    lesson,
    closeAdditional,
  };
}

export async function startAtAsk(
  store: ReturnType<typeof createSessionStore>,
  start: () => Promise<unknown>,
) {
  const result = (await start()) as { snapshot?: { session_id: string; generation: number } };
  assert.ok(result.snapshot);
  const { session_id: id, generation } = result.snapshot;
  const stream = store.openStream(id, generation);
  assert.ok(stream && !('error' in stream));
  for (let step = 0; step < 24; step += 1) {
    const poll = store.poll(stream);
    assert.equal(poll.kind, 'beat');
    if (poll.kind !== 'beat') throw new Error('Expected a classroom beat');
    assert.ok(
      'ok' in store.progress(id, { generation, last_played_step_id: poll.beat.action.step_id }),
    );
    if (poll.beat.action.type === 'ask') return { id, generation, stream, ask: poll.beat.action };
  }
  throw new Error('The teacher turn did not stop at ask');
}
