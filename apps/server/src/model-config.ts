import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createModelGateway } from '@eduharness-studio/engine/models';
import { EnvHttpProxyAgent } from 'undici';

type Environment = Readonly<Record<string, string | undefined>>;
const defaultEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));

export function loadStudioEnvironment(ambient: Environment = process.env): Environment {
  try {
    const file = ambient.STUDIO_ENV_FILE ?? defaultEnvFile;
    return { ...parseEnv(readFileSync(file, 'utf8')), ...ambient };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ambient;
    throw new Error('Could not load studio environment');
  }
}

export function configureModels(
  env: Environment,
  makeGateway = createModelGateway,
  fetchRequest: typeof globalThis.fetch = globalThis.fetch,
) {
  // Native clients can log response bodies before the gateway sees a sanitized error.
  process.env.OPENAI_LOG = 'off';
  process.env.ANTHROPIC_LOG = 'off';
  const httpsProxy = env.HTTPS_PROXY?.trim() || env.https_proxy?.trim();
  const httpProxy = env.HTTP_PROXY?.trim() || env.http_proxy?.trim();
  let dispatcher: EnvHttpProxyAgent | undefined;
  const modelFetch: typeof globalThis.fetch = (input, init) => {
    if (httpProxy || httpsProxy) {
      // Bad proxy configuration only affects model traffic.
      try {
        dispatcher ??= new EnvHttpProxyAgent({
          httpProxy: httpProxy ?? '',
          httpsProxy: httpsProxy ?? '',
          noProxy: env.NO_PROXY ?? env.no_proxy ?? '',
        });
      } catch {
        throw new Error('Invalid model proxy configuration');
      }
    }
    const request = { ...init, dispatcher };
    return fetchRequest(input, request);
  };
  const gateway = makeGateway({
    provider: env.STUDIO_MODEL_PROVIDER?.trim(),
    modelId: env.STUDIO_MODEL_ID?.trim(),
    baseUrl: env.STUDIO_MODEL_BASE_URL?.trim() || undefined,
    readEnv: (name) => env[name],
    fetch: modelFetch,
  });

  return { gateway, modelFetch, closeModelTransport: async () => dispatcher?.destroy() };
}
