import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createServerApp } from './app.js';
import { openStudioDatabase } from './db.js';

const port = Number(process.env.PORT ?? 3001);
const dbPath =
  process.env.STUDIO_DB_PATH === ':memory:'
    ? ':memory:'
    : resolve(process.cwd(), process.env.STUDIO_DB_PATH ?? 'data/studio.sqlite');

const database = openStudioDatabase(dbPath);
const app = createServerApp({ database, mode: 'offline' });

const server = serve(
  {
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port,
  },
  (info) => {
    console.log(
      `[server] eduharness-studio listening on http://127.0.0.1:${info.port} (db: ${dbPath})`,
    );
  },
);

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
