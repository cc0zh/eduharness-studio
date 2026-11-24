import type { ModelSettings } from '@eduharness-studio/engine';
import type { ModelGateway } from '@eduharness-studio/engine/models';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

export function createModelRoutes(gateway: ModelGateway) {
  const routes = new Hono();

  async function settings(): Promise<ModelSettings> {
    return { ...(await gateway.getStatus()), providers: gateway.getCatalog() };
  }

  // Never hand an exception from a credential request to Hono's default logger.
  routes.onError((_error, c) => c.json({ error: 'model_config_failed' }, 500));
  routes.use('/model', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  routes.get('/model', async (c) => c.json(await settings()));
  routes.put(
    '/model',
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: 'invalid_model_config' }, 413),
    }),
    async (c) => {
      if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return c.json({ error: 'invalid_model_config' }, 400);
      }
      const input = await c.req.json<unknown>().catch(() => undefined);
      if (!gateway.setByok(input)) return c.json({ error: 'invalid_model_config' }, 400);
      return c.json(await settings());
    },
  );
  routes.delete('/model', async (c) => {
    gateway.clearByok();
    return c.json(await settings());
  });
  return routes;
}
