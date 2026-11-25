import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { generateBlueprint, offlineLesson } from '@eduharness-studio/engine';
import { createCourseLessonPlanner } from '@eduharness-studio/engine/course';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
} from '@eduharness-studio/engine/models';
import { createTeacherPlanner, type TeacherTool } from '@eduharness-studio/engine/teacher';
import { openStudioDatabase } from '../apps/server/src/db.js';
import { sessionDatabase } from '../apps/server/src/session-db.js';
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

export const lessonDraft = (scene: unknown = opening) => ({
  keypoints: [
    {
      id: 'leftover',
      title: '识别落单积木',
      objective: '判断分组后是否有剩余。',
      depth: 'intuition',
    },
    {
      id: 'parity',
      title: '比较奇偶数量',
      objective: '用配对解释不同数量的奇偶性。',
      depth: 'application',
    },
  ],
  opening: scene,
});

export function makeFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'eduharness-teacher-lock-'));
  const path = join(directory, 'studio.sqlite');
  const database = openStudioDatabase(path);
  const closeAdditional: (() => void)[] = [];
  const faux = createFauxModelGateway();
  assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-only' }));
  const planner = createTeacherPlanner(faux.gateway);
  const store = createSessionStore(sessionDatabase(database.db), planner);
  const course = generateBlueprint('course-teacher-pairs', {
    topic: '奇偶性',
    foundation: 'beginner',
    goal: 'understand',
  });
  const lesson = course.units[0].lessons[0];
  const script = offlineLesson(course, lesson);
  t.after(() => {
    for (const close of closeAdditional) close();
    database.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  });
  const structured = (value: unknown) =>
    fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
  const options = (restart: boolean, live = true, tools?: readonly TeacherTool[]) => ({
    courseId: course.id,
    lessonId: lesson.id,
    topic: 'odd-even pairs',
    prepare: async () =>
      live
        ? (
            await createCourseLessonPlanner(
              faux.gateway,
              undefined,
              tools,
            )({ course, lesson, previousKeypoints: [] })
          ).material
        : { script },
    restart,
  });
  return {
    database,
    path,
    faux,
    planner,
    store,
    structured,
    options,
    start: () => store.start(options(false)),
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
