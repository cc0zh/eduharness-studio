import { randomUUID } from 'node:crypto';
import {
  generateBlueprint,
  IntakeGenerateSchema,
  IntakeNextSchema,
  IntakeStartSchema,
  type LessonEntry,
  nextIntake,
  offlineLesson,
  startIntake,
} from '@eduharness-studio/engine';
import {
  createCourseBlueprintPlanner,
  createCourseLessonPlanner,
} from '@eduharness-studio/engine/course';
import type { ModelGateway } from '@eduharness-studio/engine/models';
import { Type } from '@sinclair/typebox';
import { Hono } from 'hono';
import { type CourseStore, isDemoCourse, isRetiredDemo } from './course-store.js';
import { checked, RouteIdSchema } from './request-validation.js';

const CourseParamsSchema = Type.Object({ courseId: RouteIdSchema });
const UnlockParamsSchema = Type.Object({ courseId: RouteIdSchema, lessonId: RouteIdSchema });

export function createCourseRoutes(courses: CourseStore, gateway: ModelGateway) {
  const routes = new Hono();
  const planBlueprint = createCourseBlueprintPlanner(gateway);
  const planLesson = createCourseLessonPlanner(gateway);
  const unlocks = new Map<
    string,
    Promise<{ lessonId: string; status: 'ready' } | { error: string }>
  >();

  async function unlock(courseId: string, lessonId: string) {
    const key = `${courseId}/${lessonId}`;
    const pending = unlocks.get(key);
    if (pending) return pending;
    const result = (async () => {
      const course = courses.get(courseId);
      if (!course) return { error: 'course_not_found' } as const;
      const lesson = course.units
        .flatMap(({ lessons }) => lessons)
        .find(({ id }) => id === lessonId);
      if (!lesson) return { error: 'lesson_not_found' } as const;
      if (lesson.status !== 'locked') return { lessonId, status: 'ready' as const };

      const saved = courses.material(courseId, lessonId);
      const material =
        saved ??
        (!isDemoCourse(courseId) && (await gateway.getStatus()).mode === 'live'
          ? (
              await planLesson({
                course,
                lesson,
                previousKeypoints: courses.previousKeypoints(courseId, lessonId),
              })
            ).material
          : { script: offlineLesson(course, lesson) });
      const updated = courses.unlock(courseId, lessonId, material);
      return updated ? { lessonId, status: 'ready' as const } : { error: 'lesson_not_found' };
    })();
    unlocks.set(key, result);
    void result.then(
      () => {
        if (unlocks.get(key) === result) unlocks.delete(key);
      },
      () => {
        if (unlocks.get(key) === result) unlocks.delete(key);
      },
    );
    return result;
  }

  routes.get('/courses', (c) => c.json(courses.list()));

  routes.get('/courses/:courseId', checked('param', CourseParamsSchema), (c) => {
    const { courseId } = c.req.valid('param');
    if (isRetiredDemo(courseId)) return c.json({ error: 'demo_retired' }, 410);
    const blueprint = courses.get(courseId);
    return blueprint ? c.json(blueprint) : c.json({ error: 'course_not_found' }, 404);
  });

  routes.get('/demos/:courseId/entry', checked('param', CourseParamsSchema), (c) => {
    const { courseId } = c.req.valid('param');
    if (isRetiredDemo(courseId)) return c.json({ error: 'demo_retired' }, 410);
    const blueprint = courseId.startsWith('demo-') ? courses.get(courseId) : undefined;
    if (!blueprint) return c.json({ error: 'demo_not_found' }, 404);
    const lesson = blueprint.units[0].lessons[0];
    if (lesson.status === 'locked') return c.json({ error: 'lesson_locked' }, 409);
    return c.json({ courseId, lessonId: lesson.id } satisfies LessonEntry);
  });

  routes.post('/intake/start', checked('json', IntakeStartSchema), (c) =>
    c.json(startIntake(c.req.valid('json'))),
  );
  routes.post('/intake/next', checked('json', IntakeNextSchema), (c) =>
    c.json(nextIntake(c.req.valid('json'))),
  );
  routes.post('/intake/generate', checked('json', IntakeGenerateSchema), async (c) => {
    const id = `course-${randomUUID()}`;
    const answers = c.req.valid('json');
    let blueprint = generateBlueprint(id, answers);
    if ((await gateway.getStatus()).mode === 'live') {
      try {
        blueprint = (await planBlueprint(id, answers)).blueprint;
      } catch {
        return c.json({ error: 'course_generation_failed' }, 502);
      }
    }
    courses.add(blueprint);
    c.header('Location', `/api/courses/${id}`);
    return c.json(blueprint, 201);
  });

  routes.post(
    '/courses/:courseId/lessons/:lessonId/unlock',
    checked('param', UnlockParamsSchema),
    async (c) => {
      try {
        const result = await unlock(c.req.valid('param').courseId, c.req.valid('param').lessonId);
        if (!('error' in result)) return c.json(result);
        return c.json(
          result,
          result.error === 'course_not_found' || result.error === 'lesson_not_found' ? 404 : 409,
        );
      } catch {
        return c.json({ error: 'lesson_generation_failed' }, 502);
      }
    },
  );

  return routes;
}
