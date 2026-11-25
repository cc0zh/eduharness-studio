import {
  evaluateOfflineQuality,
  type LessonEnd,
  type LessonMetadata,
  projectPlayedDialogue,
  type SessionQuality,
} from '@eduharness-studio/engine';
import { Type } from '@sinclair/typebox';
import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { type CourseStore, isRetiredDemo } from './course-store.js';
import { generationFailure, type LessonLifecycle } from './lesson-lifecycle.js';
import { checked, RouteIdSchema } from './request-validation.js';
import {
  AnswerSchema,
  EmptyBody,
  InterruptSchema,
  ProgressSchema,
  ResumeSchema,
  StartSchema,
} from './session-input.js';
import type { createSessionStore } from './session-store.js';

const LessonParams = Type.Object({ courseId: RouteIdSchema, lessonId: RouteIdSchema });
const SessionParams = Type.Object({ sessionId: RouteIdSchema });
const StreamQuery = Type.Object({
  generation: Type.Optional(Type.String({ pattern: '^[1-9][0-9]{0,15}$' })),
});
const LESSON_PATH = '/courses/:courseId/lessons/:lessonId';
const SESSION_PATH = '/sessions/:sessionId';

function writeStatus(error: string) {
  if (error === 'session_not_found') return 404;
  if (error === 'session_retired') return 410;
  if (error === 'teacher_turn_failed') return 502;
  return 409;
}

function failedOpening(
  c: Context,
  error: unknown,
  code: 'lesson_generation_failed' | 'teacher_turn_failed',
) {
  const failure = generationFailure(error);
  const detail = failure.reasons?.join(' | ') ?? '';
  console.error(
    `[studio] 502 ${c.req.method} ${c.req.path} ${code}/${failure.failure}${detail ? `: ${detail}` : ''}`,
  );
  return c.json({ error: code, ...failure }, 502);
}

export function createLessonRoutes(
  courses: CourseStore,
  lifecycle: LessonLifecycle,
  sessions: ReturnType<typeof createSessionStore>,
) {
  const routes = new Hono();

  function resolveLesson({ courseId, lessonId }: { courseId: string; lessonId: string }) {
    if (isRetiredDemo(courseId)) return { error: 'demo_retired', status: 410 } as const;
    const { course, lesson } = courses.lesson(courseId, lessonId);
    if (!course || !lesson) return { error: 'lesson_not_found', status: 404 } as const;
    if (lesson.status === 'locked') return { error: 'lesson_locked', status: 409 } as const;
    return { course, lesson };
  }

  routes.get(LESSON_PATH, checked('param', LessonParams), async (c) => {
    const result = resolveLesson(c.req.valid('param'));
    if (!result.course) return c.json({ error: result.error }, result.status);
    c.header('Cache-Control', 'no-store');
    const { course, lesson } = result;
    const active = sessions.outline(course.id, lesson.id);
    if (active) {
      // Leave a retired lesson's outline empty so the whiteboard can offer an explicit restart.
      // A recoverable session already owns its outline, even after a model-mode change.
      const keypoints = 'error' in active ? [] : active;
      return c.json({ keypoints } satisfies LessonMetadata);
    }
    try {
      const prepared = await lifecycle.prepare(course, lesson);
      return 'error' in prepared
        ? c.json(prepared, 409)
        : c.json({ keypoints: prepared.script.keypoints } satisfies LessonMetadata);
    } catch (error) {
      return failedOpening(c, error, 'lesson_generation_failed');
    }
  });

  routes.get(`${LESSON_PATH}/sessions/active`, checked('param', LessonParams), (c) => {
    const params = c.req.valid('param');
    const result = resolveLesson(params);
    if (!result.course) return c.json({ error: result.error }, result.status);
    c.header('Cache-Control', 'no-store');
    const snapshot = sessions.active(params.courseId, params.lessonId);
    return snapshot && 'error' in snapshot ? c.json(snapshot, 410) : c.json(snapshot);
  });

  routes.post(
    `${LESSON_PATH}/sessions`,
    checked('param', LessonParams),
    checked('json', StartSchema),
    async (c) => {
      const params = c.req.valid('param');
      const result = resolveLesson(params);
      if (!result.course) return c.json({ error: result.error }, result.status);
      const { course, lesson } = result;
      try {
        const started = await sessions.start({
          ...params,
          topic: course.topic,
          prepare: () => lifecycle.prepare(course, lesson),
          restart: c.req.valid('json').restart === true,
        });
        return 'error' in started
          ? c.json(started, writeStatus(started.error))
          : c.json(started.snapshot, started.created ? 201 : 200);
      } catch (error) {
        return failedOpening(c, error, 'teacher_turn_failed');
      }
    },
  );

  routes.get(`${SESSION_PATH}/xray`, checked('param', SessionParams), (c) => {
    const inspection = sessions.inspect(c.req.valid('param').sessionId);
    c.header('Cache-Control', 'no-store');
    return inspection ? c.json(inspection.trace) : c.json({ error: 'session_not_found' }, 404);
  });

  routes.post(
    `${SESSION_PATH}/quality`,
    checked('param', SessionParams),
    checked('json', EmptyBody),
    (c) => {
      const inspection = sessions.inspect(c.req.valid('param').sessionId);
      if (!inspection) return c.json({ error: 'session_not_found' }, 404);
      const { generation, last_played_step_id, playedActions, records } = inspection.snapshot;
      const dialogue = projectPlayedDialogue(playedActions, records);
      return c.json({
        generation,
        last_played_step_id,
        dialogue,
        ...evaluateOfflineQuality(dialogue, playedActions, records, inspection.trace.transitions),
      } satisfies SessionQuality);
    },
  );

  routes.post(
    `${SESSION_PATH}/resume`,
    checked('param', SessionParams),
    checked('json', ResumeSchema),
    (c) => {
      const result = sessions.resume(c.req.valid('param').sessionId, c.req.valid('json'));
      return !result
        ? c.json({ error: 'session_not_found' }, 404)
        : 'error' in result
          ? c.json(result, result.error === 'session_retired' ? 410 : 409)
          : c.json(result);
    },
  );

  routes.get(
    `${SESSION_PATH}/stream`,
    checked('param', SessionParams),
    checked('query', StreamQuery),
    (c) => {
      const sessionId = c.req.valid('param').sessionId;
      const generationText = c.req.valid('query').generation;
      if (!generationText) {
        return sessions.isUnversioned(sessionId)
          ? c.json({ error: 'session_retired' }, 410)
          : c.json({ error: 'generation_required' }, 400);
      }
      const generation = Number(generationText);
      if (!Number.isSafeInteger(generation)) return c.json({ error: 'invalid_input' }, 400);
      const active = sessions.openStream(sessionId, generation);
      if (!active) return c.json({ error: 'session_not_found' }, 404);
      if ('error' in active) return c.json(active, 410);
      const data = JSON.stringify({ generation });
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: 'stream', data });
        let waiting = 0;
        while (!stream.aborted) {
          const next = sessions.poll(active);
          if (next.kind === 'beat') {
            const { beat } = next;
            await stream.writeSSE({
              event: 'beat',
              id: `${generation}:${beat.seq}`,
              data: JSON.stringify(beat),
            });
            waiting = 0;
          } else if (next.kind === 'waiting') {
            if (++waiting % 150 === 0) await stream.write(': waiting\n\n');
            await stream.sleep(100);
          } else {
            const ended: LessonEnd = { generation, snapshot: next.snapshot };
            await stream.writeSSE({ event: next.kind, data: JSON.stringify(ended) });
            return;
          }
        }
      });
    },
  );

  function updated(
    c: Context,
    result:
      | Awaited<ReturnType<typeof sessions.interrupt> | ReturnType<typeof sessions.answer>>
      | ReturnType<typeof sessions.progress>
      | undefined,
  ) {
    if (!result) return c.json({ error: 'session_not_found' }, 404);
    if ('error' in result) {
      const status = writeStatus(result.error ?? 'teacher_turn_failed');
      if (status === 502) {
        const detail =
          'reasons' in result && Array.isArray(result.reasons) ? result.reasons.join(' | ') : '';
        console.error(
          `[studio] 502 POST ${c.req.path} ${result.error}${'failure' in result && result.failure ? `/${result.failure}` : ''}${detail ? `: ${detail}` : ''}`,
        );
      }
      return c.json(result, status);
    }
    return c.json(result);
  }

  routes.post(
    `${SESSION_PATH}/progress`,
    checked('param', SessionParams),
    checked('json', ProgressSchema),
    (c) => {
      const result = sessions.progress(c.req.valid('param').sessionId, c.req.valid('json'));
      // A late ACK from a replaced stream is expected; let the SSE handoff carry authority.
      if ('error' in result && result.error === 'stale_generation') return c.json(result);
      return updated(c, result);
    },
  );
  routes.post(
    `${SESSION_PATH}/answer`,
    checked('param', SessionParams),
    checked('json', AnswerSchema),
    async (c) =>
      updated(c, await sessions.answer(c.req.valid('param').sessionId, c.req.valid('json'))),
  );
  routes.post(
    `${SESSION_PATH}/interrupt`,
    checked('param', SessionParams),
    checked('json', InterruptSchema),
    async (c) =>
      updated(c, await sessions.interrupt(c.req.valid('param').sessionId, c.req.valid('json'))),
  );

  return routes;
}
