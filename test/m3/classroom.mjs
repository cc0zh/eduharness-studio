import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createServerApp } from '../../apps/server/src/app.ts';
import { openStudioDatabase } from '../../apps/server/src/db.ts';
import { configureModels } from '../../apps/server/src/model-config.ts';
import { startBrowserFixture } from '../browser-fixture.mjs';
import { offlineServerEnv } from '../studio-test-env.mjs';
import { browserNetworkTrap, monitorPage } from './browser-network.mjs';
import { playScene } from './play-scene.mjs';
import { fauxKey, startScriptedModel } from './scripted-model.mjs';

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const instance = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () =>
      resolve(instance),
    );
    instance.once('error', reject);
  });
  const { port } = server.address();
  return {
    port,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      await new Promise((resolve, reject) => {
        const probe = createConnection({ host: '127.0.0.1', port });
        probe.once('error', (error) => (error.code === 'ECONNREFUSED' ? resolve() : reject(error)));
        probe.once('connect', () => {
          probe.destroy();
          reject(new Error('Capture API port remains open'));
        });
      });
    },
  };
}

export function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
}

export async function captureScene(scene, directory, settings, budget, signal) {
  mkdirSync(directory);
  const databasePath = join(directory, 'studio.sqlite');
  const isFaux = settings.mode === 'faux';
  const before = budget.total();
  const cleanup = [];
  const failures = [];
  let trap;
  let evidence;
  try {
    const mock = isFaux ? await startScriptedModel(scene) : undefined;
    if (mock) cleanup.unshift(mock.close);
    trap = await browserNetworkTrap();
    cleanup.unshift(trap.close);
    const env = mock?.env ?? settings.modelEnv;
    const transport = budget.fetchFor(scene.id, mock?.endpoint ?? settings.endpoint);
    const { gateway, modelFetch, closeModelTransport } = configureModels(env, undefined, transport);
    cleanup.unshift(closeModelTransport);
    const selected = await gateway.getStatus();
    assert.equal(selected.mode, 'live', 'Model required for the entire capture');
    assert.equal(selected.provider, env.STUDIO_MODEL_PROVIDER);
    assert.equal(selected.modelId, env.STUDIO_MODEL_ID);
    const database = openStudioDatabase(databasePath);
    cleanup.unshift(() => database.close());
    const server = await listen(createServerApp({ database, modelGateway: gateway, modelFetch }));
    cleanup.unshift(server.close);
    const noEnvFile = join(directory, 'no-dotenv');
    const fixture = await startBrowserFixture(
      { signal, after: (fn) => cleanup.unshift(fn) },
      {
        capture: {
          port: server.port,
          database: databasePath,
          chrome: { proxy: trap.proxy, args: trap.args, env: offlineServerEnv(noEnvFile) },
        },
      },
    );
    const { page, url } = fixture;
    const monitor = await monitorPage(
      page,
      (target) => target.origin === url || target.origin === url.replace('http:', 'ws:'),
    );
    const lesson = await playScene(fixture, scene, directory, isFaux);
    monitor.verify();
    budget.assertHealthy();
    const posts = budget.total() - before;
    const faux = mock?.verify(posts);
    if (isFaux && scene.cut) assert.equal(faux.anchor, lesson.cut.step);
    evidence = { scene: scene.id, mode: settings.mode, ...lesson, posts, faux, ...monitor.counts };
    await page.close();
    monitor.verify();
  } catch (error) {
    failures.push(error);
  } finally {
    for (const close of cleanup) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Capture and cleanup failed');
  evidence.rejectedBrowserProxyConnections = trap.connections();
  assert.ok(existsSync(databasePath));
  if (isFaux) assert.equal(readFileSync(databasePath).includes(fauxKey), false);
  writeJson(join(directory, 'capture.json'), evidence);
  return evidence;
}
