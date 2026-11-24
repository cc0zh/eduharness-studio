import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createServerApp } from './app.js';
import { openStudioDatabase } from './db.js';
import { configureModels, loadStudioEnvironment } from './model-config.js';

const env = loadStudioEnvironment();
const port = Number(env.PORT ?? 3001);
const dbPath =
  env.STUDIO_DB_PATH === ':memory:'
    ? ':memory:'
    : resolve(process.cwd(), env.STUDIO_DB_PATH ?? 'data/studio.sqlite');

const { gateway, modelFetch, closeModelTransport } = configureModels(env);
const database = openStudioDatabase(dbPath);
const app = createServerApp({ database, modelGateway: gateway, modelFetch });

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
    void closeModelTransport().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
