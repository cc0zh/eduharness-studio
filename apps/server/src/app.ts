import { PROTOCOL_VERSION } from '@eduharness-studio/engine';
import { createModelGateway, type ModelGateway } from '@eduharness-studio/engine/models';
import type { TeacherTool } from '@eduharness-studio/engine/teacher';
import { Hono } from 'hono';
import { createCourseRoutes } from './course-routes.js';
import { createCourseStore } from './course-store.js';
import type { StudioDatabase } from './db.js';
import { createLessonRoutes } from './lesson-routes.js';
import { createModelRoutes } from './model-routes.js';

export interface ServerAppOptions {
  database: StudioDatabase;
  modelGateway?: ModelGateway;
  teacherTools?: readonly TeacherTool[];
}

export function createServerApp({
  database,
  modelGateway = createModelGateway(),
  teacherTools,
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
  app.route('/api', createModelRoutes(modelGateway));
  app.route('/api', createCourseRoutes(courses));
  app.route('/api', createLessonRoutes(courses, database, modelGateway, teacherTools));
  return app;
}
