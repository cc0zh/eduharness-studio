import {
  evaluateOfflineQuality,
  type LessonEnd,
  type LessonMetadata,
  offlineLesson,
  projectPlayedDialogue,
  type SessionQuality,
} from '@eduharness-studio/engine';
import type { ModelGateway } from '@eduharness-studio/engine/models';
import { createTeacherPlanner, type TeacherTool } from '@eduharness-studio/engine/teacher';
import { Type } from '@sinclair/typebox';
import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { type CourseStore, isDemoCourse, isRetiredDemo } from './course-store.js';
import type { StudioDatabase } from './db.js';
import { checked, RouteIdSchema } from './request-validation.js';
import {
  AnswerSchema,
  EmptyBody,
  InterruptSchema,
  ProgressSchema,
  ResumeSchema,
  StartSchema,
} from './session-input.js';
import { createSessionStore } from './session-store.js';

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

export function createLessonRoutes(
  courses: CourseStore,
  database: StudioDatabase,
  gateway: ModelGateway,
  tools?: readonly TeacherTool[],
) {
  const sessions = createSessionStore(database, createTeacherPlanner(gateway, tools));
  const routes = new Hono();

  function resolveLesson({ courseId, lessonId }: { courseId: string; lessonId: string }) {
    if (isRetiredDemo(courseId)) return { error: 'demo_retired', status: 410 } as const;
    const course = courses.get(courseId);
    const lesson = course?.units
      .flatMap(({ lessons }) => lessons)
      .find(({ id }) => id === lessonId);
    if (!course || !lesson) return { error: 'lesson_not_found', status: 404 } as const;
    if (lesson.status === 'locked') return { error: 'lesson_locked', status: 409 } as const;
    return { course, lesson, material: courses.material(courseId, lessonId) };
  }

  routes.get(LESSON_PATH, checked('param', LessonParams), async (c) => {
    const result = resolveLesson(c.req.valid('param'));
    if (!result.course) return c.json({ error: result.error }, result.status);
    const live = !isDemoCourse(result.course.id) && (await gateway.getStatus()).mode === 'live';
    const script = live
      ? (result.material?.script ?? offlineLesson(result.course, result.lesson))
      : offlineLesson(result.course, result.lesson);
    return c.json({ keypoints: script.keypoints } satisfies LessonMetadata);
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
      const live = !isDemoCourse(params.courseId) && (await gateway.getStatus()).mode === 'live';
      const material = live ? result.material : undefined;
      const started = await sessions.start({
        ...params,
        topic: result.course.topic,
        buildScript: () => material?.script ?? offlineLesson(result.course, result.lesson),
        restart: c.req.valid('json').restart === true,
        live,
        preplanned: Boolean(material),
        basis: material?.basis,
        openingEvidence: material?.openingEvidence,
      });
      return 'error' in started
        ? c.json(started, writeStatus(started.error))
        : c.json(started.snapshot, started.created ? 201 : 200);
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
    return 'error' in result
      ? c.json(result, writeStatus(result.error ?? 'teacher_turn_failed'))
      : c.json(result);
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
