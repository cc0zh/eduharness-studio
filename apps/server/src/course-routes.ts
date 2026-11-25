import { randomUUID } from 'node:crypto';
import {
  generateBlueprint,
  IntakeGenerateSchema,
  IntakeNextSchema,
  IntakeStartSchema,
  type LessonEntry,
  nextIntake,
  startIntake,
} from '@eduharness-studio/engine';
import { createCourseBlueprintPlanner } from '@eduharness-studio/engine/course';
import type { ModelGateway } from '@eduharness-studio/engine/models';
import { Type } from '@sinclair/typebox';
import { Hono } from 'hono';
import { type CourseStore, isRetiredDemo } from './course-store.js';
import { generationFailure, type LessonLifecycle } from './lesson-lifecycle.js';
import { checked, RouteIdSchema } from './request-validation.js';

const CourseParamsSchema = Type.Object({ courseId: RouteIdSchema });
const UnlockParamsSchema = Type.Object({ courseId: RouteIdSchema, lessonId: RouteIdSchema });

export function createCourseRoutes(
  courses: CourseStore,
  gateway: ModelGateway,
  lifecycle: LessonLifecycle,
) {
  const routes = new Hono();
  const planBlueprint = createCourseBlueprintPlanner(gateway);

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
      } catch (error) {
        const failure = generationFailure(error);
        const detail = failure.reasons?.join(' | ') ?? '';
        console.error(
          `[studio] 502 POST ${c.req.path} course_generation_failed/${failure.failure}${detail ? `: ${detail}` : ''}`,
        );
        return c.json({ error: 'course_generation_failed', ...failure }, 502);
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
      const { courseId, lessonId } = c.req.valid('param');
      const { course, lesson } = courses.lesson(courseId, lessonId);
      if (!course) return c.json({ error: 'course_not_found' }, 404);
      if (!lesson) return c.json({ error: 'lesson_not_found' }, 404);
      try {
        const result = await lifecycle.unlock(course, lesson);
        if ('error' in result) return c.json(result, 409);
        return c.json(result);
      } catch (error) {
        const failure = generationFailure(error);
        const detail = failure.reasons?.join(' | ') ?? '';
        console.error(
          `[studio] 502 POST ${c.req.path} lesson_generation_failed/${failure.failure}${detail ? `: ${detail}` : ''}`,
        );
        return c.json({ error: 'lesson_generation_failed', ...failure }, 502);
      }
    },
  );

  return routes;
}
