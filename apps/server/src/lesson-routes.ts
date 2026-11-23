import { type LessonMetadata, offlineLesson } from '@eduharness-studio/engine';
import { Type } from '@sinclair/typebox';
import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { CourseStore } from './course-store.js';
import type { StudioDatabase } from './db.js';
import { checked, RouteIdSchema } from './request-validation.js';
import { AnswerSchema, createSessionStore, ProgressSchema } from './session-store.js';

const LessonParams = Type.Object({ courseId: RouteIdSchema, lessonId: RouteIdSchema });
const SessionParams = Type.Object({ sessionId: RouteIdSchema });
const EmptyBody = Type.Object({}, { additionalProperties: false });
const LESSON_PATH = '/courses/:courseId/lessons/:lessonId';
const SESSION_PATH = '/sessions/:sessionId';

export function createLessonRoutes(courses: CourseStore, database: StudioDatabase) {
  const sessions = createSessionStore(database);
  const routes = new Hono();

  function lessonScript({ courseId, lessonId }: { courseId: string; lessonId: string }) {
    const course = courses.get(courseId);
    const lesson = course?.units
      .flatMap(({ lessons }) => lessons)
      .find(({ id }) => id === lessonId);
    if (!course || !lesson) return { error: 'lesson_not_found', status: 404 } as const;
    if (lesson.status === 'locked') return { error: 'lesson_locked', status: 409 } as const;
    return { script: offlineLesson(course, lesson) };
  }

  routes.get(LESSON_PATH, checked('param', LessonParams), (c) => {
    const result = lessonScript(c.req.valid('param'));
    return result.script
      ? c.json({ keypoints: result.script.keypoints } satisfies LessonMetadata)
      : c.json({ error: result.error }, result.status);
  });

  routes.post(
    `${LESSON_PATH}/sessions`,
    checked('param', LessonParams),
    checked('json', EmptyBody),
    (c) => {
      const params = c.req.valid('param');
      const result = lessonScript(params);
      if (!result.script) return c.json({ error: result.error }, result.status);
      return c.json(
        { session_id: sessions.create(params.courseId, params.lessonId, result.script) },
        201,
      );
    },
  );

  routes.get(`${SESSION_PATH}/stream`, checked('param', SessionParams), (c) => {
    const active = sessions.openStream(c.req.valid('param').sessionId);
    if (!active) return c.json({ error: 'session_not_found' }, 404);
    const { generation } = active;
    const data = JSON.stringify({ generation });
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'stream', data });
      let waiting = 0;
      while (!stream.aborted) {
        const next = sessions.poll(active);
        if (next.kind === 'done' || next.kind === 'superseded') {
          await stream.writeSSE({ event: next.kind, data });
          return;
        }
        if (next.kind === 'beat') {
          const { beat } = next;
          await stream.writeSSE({
            event: 'beat',
            id: `${generation}:${beat.seq}`,
            data: JSON.stringify(beat),
          });
          waiting = 0;
        } else {
          if (++waiting % 150 === 0) await stream.write(': waiting\n\n');
          await stream.sleep(100);
        }
      }
    });
  });

  function updated(c: Context, result: ReturnType<typeof sessions.progress>) {
    return result === 'ok'
      ? c.json({ ok: true })
      : c.json({ error: result }, result === 'session_not_found' ? 404 : 409);
  }

  routes.post(
    `${SESSION_PATH}/progress`,
    checked('param', SessionParams),
    checked('json', ProgressSchema),
    (c) => updated(c, sessions.progress(c.req.valid('param').sessionId, c.req.valid('json'))),
  );
  routes.post(
    `${SESSION_PATH}/answer`,
    checked('param', SessionParams),
    checked('json', AnswerSchema),
    (c) => updated(c, sessions.answer(c.req.valid('param').sessionId, c.req.valid('json'))),
  );

  return routes;
}
