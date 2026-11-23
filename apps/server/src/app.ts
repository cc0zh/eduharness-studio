import { PROTOCOL_VERSION } from '@eduharness-studio/engine';
import { Hono } from 'hono';
import { createCourseRoutes } from './course-routes.js';
import { createCourseStore } from './course-store.js';
import type { StudioDatabase } from './db.js';
import { createLessonRoutes } from './lesson-routes.js';

export interface ServerAppOptions {
  database: StudioDatabase;
  mode?: 'offline' | 'live';
}

export function createServerApp({ database, mode = 'offline' }: ServerAppOptions): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => {
    const dbHealth = database.checkHealth();
    return c.json({
      ok: true,
      service: 'eduharness-studio-server',
      protocolVersion: PROTOCOL_VERSION,
      mode,
      sqlite: dbHealth.ok ? 'ok' : 'error',
      tables: dbHealth.tables,
    });
  });

  app.get('/api/meta', (c) => {
    return c.json({
      service: 'eduharness-studio-server',
      protocolVersion: PROTOCOL_VERSION,
      mode,
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
  app.route('/api', createCourseRoutes(courses));
  app.route('/api', createLessonRoutes(courses, database));
  return app;
}
