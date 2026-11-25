import { PROTOCOL_VERSION } from '@eduharness-studio/engine';
import { createModelGateway, type ModelGateway } from '@eduharness-studio/engine/models';
import { createTeacherPlanner, type TeacherTool } from '@eduharness-studio/engine/teacher';
import { Hono } from 'hono';
import { createCourseRoutes } from './course-routes.js';
import { createCourseStore } from './course-store.js';
import type { StudioDatabase } from './db.js';
import { createLessonLifecycle } from './lesson-lifecycle.js';
import { createLessonRoutes } from './lesson-routes.js';
import { createModelRoutes } from './model-routes.js';
import { sessionDatabase } from './session-db.js';
import { createSessionStore } from './session-store.js';

export interface ServerAppOptions {
  database: StudioDatabase;
  modelGateway?: ModelGateway;
  teacherTools?: readonly TeacherTool[];
  modelFetch?: typeof globalThis.fetch;
}

export function createServerApp({
  database,
  modelGateway = createModelGateway(),
  teacherTools,
  modelFetch = globalThis.fetch,
}: ServerAppOptions): Hono {
  const app = new Hono();

  app.get('/api/health', async (c) => {
    const dbHealth = database.checkHealth();
    return c.json({
      ok: true,
      service: 'eduharness-studio-server',
      protocolVersion: PROTOCOL_VERSION,
      mode: (await modelGateway.getStatus()).mode,
      sqlite: dbHealth.ok ? 'ok' : 'error',
      tables: dbHealth.tables,
    });
  });

  app.get('/api/meta', async (c) => {
    return c.json({
      service: 'eduharness-studio-server',
      protocolVersion: PROTOCOL_VERSION,
      mode: (await modelGateway.getStatus()).mode,
      architecture: 'two-layer-dynamic-curriculum',
      capabilities: [
        'course-blueprint',
        'dynamic-keypoints',
        'beat-action-stream',
        'session-restore',
        'intent-interrupt',
        'teaching-state',
        'agent-xray',
      ],
    });
  });

  const courses = createCourseStore(database);
  const store = sessionDatabase(database.db);
  const lifecycle = createLessonLifecycle(courses, store, modelGateway, teacherTools);
  const sessions = createSessionStore(store, createTeacherPlanner(modelGateway, teacherTools));
  app.route('/api', createModelRoutes(modelGateway, modelFetch));
  app.route('/api', createCourseRoutes(courses, modelGateway, lifecycle));
  app.route('/api', createLessonRoutes(courses, lifecycle, sessions));
  return app;
}
