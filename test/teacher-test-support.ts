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
  panels: [
    {
      title: '积木分组',
      content: '五块积木试着两两配对。',
      highlight: '两两',
      voiceover: '先每两块摆成一组。',
    },
  ],
  next_ask: { prompt: '最后会剩下什么？' },
};

export const scaffold = {
  diagnosis: { status: 'low_effort', summary: '尚无判断。', strategy: '轻量点选。' },
  panels: [
    {
      title: '先摆一组',
      content: '每组摆两块。',
      highlight: '两块',
      voiceover: '先选一个直觉判断。',
    },
  ],
  next_ask: { prompt: '五块会怎样？', options: ['剩下一块', '没有剩余'] },
};

// The teacher proposes the next scene; only the engine can mark a point unverified.
export const afterSkip = {
  diagnosis: {
    status: 'low_effort',
    summary: '连续回复仍没有显示推理。',
    strategy: '换个例子继续。',
  },
  panels: [{ title: '下一组积木', content: '现在看六块积木。', voiceover: '还是每一组摆两块。' }],
  next_ask: { prompt: '六块可以分成几对？' },
};

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
