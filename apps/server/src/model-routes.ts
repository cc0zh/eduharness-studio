import type { ModelSettings } from '@eduharness-studio/engine';
import { ModelConfigError, type ModelGateway } from '@eduharness-studio/engine/models';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { fetchModelList, ModelListError } from './model-list.js';

export function createModelRoutes(gateway: ModelGateway, modelFetch: typeof globalThis.fetch) {
  const routes = new Hono();
  const limitBody = bodyLimit({
    maxSize: 32 * 1024,
    onError: (c) => c.json({ error: 'invalid_model_config' }, 413),
  });

  async function settings(): Promise<ModelSettings> {
    return { ...(await gateway.getStatus()), providers: gateway.getCatalog() };
  }

  // Never hand an exception from a credential request to Hono's default logger.
  routes.onError((error, c) => {
    if (error instanceof ModelConfigError) return c.json({ error: error.code }, 400);
    if (error instanceof ModelListError)
      return c.json({ error: error.code }, error.code === 'model_list_timeout' ? 504 : 502);
    return c.json({ error: 'model_config_failed' }, 500);
  });
  routes.use('/model/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const site = c.req.header('Sec-Fetch-Site');
    const host = new URL(c.req.url).hostname;
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(host) ||
      (site && site !== 'same-origin' && site !== 'none')
    ) {
      return c.json({ error: 'model_local_request_required' }, 403);
    }
    if (
      ['PUT', 'POST'].includes(c.req.method) &&
      c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    ) {
      return c.json({ error: 'invalid_model_config' }, 400);
    }
    await next();
  });
  routes.get('/model', async (c) => c.json(await settings()));
  routes.put('/model', limitBody, async (c) => {
    gateway.setByok(await c.req.json<unknown>().catch(() => undefined));
    return c.json(await settings());
  });
  routes.post('/model/fetch-models', limitBody, async (c) => {
    const connection = await gateway.modelListConnection(
      await c.req.json<unknown>().catch(() => undefined),
    );
    return c.json({ models: await fetchModelList(connection, modelFetch, c.req.raw.signal) });
  });
  routes.delete('/model', async (c) => {
    gateway.clearByok();
    return c.json(await settings());
  });
  return routes;
}
