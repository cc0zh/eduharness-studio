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
import { type TSchema, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { createCourseStore } from './course-store.js';
import type { StudioDatabase } from './db.js';

const CourseParamsSchema = Type.Object({
  courseId: Type.String({ pattern: '^[a-z0-9-]+$', minLength: 1, maxLength: 80 }),
});

function checked<Target extends 'json' | 'param', Schema extends TSchema>(
  target: Target,
  schema: Schema,
) {
  return validator(target, (input, c) => {
    if (Value.Check(schema, input)) return input;
    return c.json(
      { error: 'invalid_input', field: Value.Errors(schema, input).First()?.path || '/' },
      400,
    );
  });
}

export function createCourseRoutes(database: StudioDatabase) {
  const courses = createCourseStore(database);
  const routes = new Hono();

  routes.get('/courses', (c) => c.json(courses.list()));

  routes.get('/courses/:courseId', checked('param', CourseParamsSchema), (c) => {
    const blueprint = courses.get(c.req.valid('param').courseId);
    return blueprint ? c.json(blueprint) : c.json({ error: 'course_not_found' }, 404);
  });

  routes.get('/demos/:courseId/entry', checked('param', CourseParamsSchema), (c) => {
    const { courseId } = c.req.valid('param');
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
  routes.post('/intake/generate', checked('json', IntakeGenerateSchema), (c) => {
    const id = `course-${randomUUID()}`;
    const blueprint = generateBlueprint(id, c.req.valid('json'));
    courses.add(blueprint);
    c.header('Location', `/api/courses/${id}`);
    return c.json(blueprint, 201);
  });

  return routes;
}
