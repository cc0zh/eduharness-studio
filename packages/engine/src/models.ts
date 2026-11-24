import {
  type Api,
  createModels,
  envApiKeyAuth,
  fauxProvider,
  type Model,
  type Models,
} from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { ModelCatalogEntry } from './model-protocol.js';
import { type ModelGateway, ModelGenerationError } from './structured-model.js';

export {
  type ModelGateway,
  ModelGenerationError,
  type StructuredModelRequest,
} from './structured-model.js';

// Scope the UI to built-in providers that take a single API key and accept injected fetch.
const providerIds = ['openai', 'anthropic', 'deepseek', 'moonshotai', 'openrouter'];
const outputTool = 'emit_result';
const maxAttempts = 2;

const ByokSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 80 }),
    modelId: Type.String({ minLength: 1, maxLength: 240 }),
    apiKey: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);

export interface ModelGatewayOptions {
  provider?: string;
  modelId?: string;
  readEnv?: (name: string) => string | undefined;
  fetch?: typeof globalThis.fetch;
}

type Selection = { model: Model<Api> } & ({ source: 'env' } | { source: 'byok'; apiKey: string });

function authContext(readEnv: ModelGatewayOptions['readEnv']) {
  return {
    env: async (name: string) => readEnv?.(name)?.trim() || undefined,
    fileExists: async () => false,
  };
}

async function selectFromEnv(
  registry: Models,
  providers: readonly string[],
  options: ModelGatewayOptions,
): Promise<Selection | undefined> {
  for (const provider of providers) {
    if (options.provider && provider !== options.provider) continue;
    const model = options.modelId
      ? registry.getModel(provider, options.modelId)
      : registry.getModels(provider)[0];
    // The supported providers resolve env auth locally, without contacting their endpoint.
    if (model && (await registry.checkAuth(provider).catch(() => undefined))) {
      return { model, source: 'env' };
    }
  }
  return undefined;
}

function createGateway(
  registry: Models,
  providers: readonly string[],
  options: ModelGatewayOptions,
): ModelGateway {
  const catalog = providers.flatMap((id): ModelCatalogEntry[] => {
    const provider = registry.getProvider(id);
    const models = registry.getModels(id).map(({ id, name }) => ({ id, name }));
    return provider && models.length ? [{ id, name: provider.name ?? id, models }] : [];
  });
  const envSelection = selectFromEnv(registry, providers, options);
  let byok: Selection | undefined;
  async function select() {
    const fallback = await envSelection;
    return byok ?? fallback;
  }

  return {
    async getStatus() {
      const selected = await select();
      return selected
        ? {
            mode: 'live',
            provider: selected.model.provider,
            modelId: selected.model.id,
            source: selected.source,
          }
        : { mode: 'offline', provider: null, modelId: null, source: 'none' };
    },
    getCatalog: () => catalog,
    setByok(credentials) {
      if (!Value.Check(ByokSchema, credentials)) return false;
      const { provider, modelId, apiKey } = credentials;
      const model = providers.includes(provider) && registry.getModel(provider, modelId);
      const key = apiKey.trim();
      if (!model || !/^[!-~]+$/.test(key)) return false;
      byok = { model, source: 'byok', apiKey: key };
      return true;
    },
    clearByok() {
      byok = undefined;
    },
    async generate({
      schema,
      prompt,
      timeoutMs = 30_000,
      maxTokens = 2048,
      attempts = maxAttempts,
    }) {
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      const fail = (code: ModelGenerationError['code']) =>
        new ModelGenerationError(code, elapsed());
      if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 60_000 ||
        !Number.isSafeInteger(maxTokens) ||
        maxTokens < 1 ||
        (attempts !== 1 && attempts !== maxAttempts)
      ) {
        throw fail('model_invalid_options');
      }

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(fail('model_timeout'));
        }, timeoutMs);
      });
      try {
        const selected = await Promise.race([select(), deadline]);
        if (!selected) throw fail('model_offline');
        const { model } = selected;
        const parameters = Type.Object({ value: schema }, { additionalProperties: false });
        for (let attempt = 0; attempt < attempts; attempt++) {
          const completion = registry.completeSimple(
            model,
            {
              systemPrompt: `Return the answer with exactly one ${outputTool} tool call. ${attempt ? 'The previous response did not match the schema. Follow it exactly.' : ''}`,
              messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
              tools: [
                { name: outputTool, description: 'Return the structured result.', parameters },
              ],
            },
            {
              apiKey: selected.source === 'byok' ? selected.apiKey : undefined,
              fetch: options.fetch,
              maxTokens: Math.min(maxTokens, model.maxTokens),
              maxRetries: 0,
              signal: controller.signal,
              timeoutMs,
            },
          );
          const response = await Promise.race([completion, deadline]);
          if (controller.signal.aborted) throw fail('model_timeout');
          if (!['toolUse', 'stop', 'length'].includes(response.stopReason)) {
            throw fail('model_request_failed');
          }
          const [call, extra] = response.content.filter((part) => part.type === 'toolCall');
          if (response.stopReason === 'toolUse' && call?.name === outputTool && !extra) {
            const args = call.arguments;
            const value: unknown = args.value;
            if (
              Object.hasOwn(args, 'value') &&
              Object.keys(args).length === 1 &&
              Value.Check(schema, value)
            ) {
              return { value, durationMs: elapsed() };
            }
          }
        }
        throw fail('model_invalid_output');
      } catch (error) {
        // Provider errors, response text and validation details can contain credentials.
        if (error instanceof ModelGenerationError) throw error;
        throw fail(controller.signal.aborted ? 'model_timeout' : 'model_request_failed');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createModelGateway(options: ModelGatewayOptions = {}): ModelGateway {
  return createGateway(
    builtinModels({ authContext: authContext(options.readEnv) }),
    providerIds,
    options,
  );
}

/** A separate SDK registry with no network providers, for deterministic tests. */
export function createFauxModelGateway(options: ModelGatewayOptions = {}) {
  const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }, { id: 'faux-2' }] });
  const registry = createModels({ authContext: authContext(options.readEnv) });
  registry.setProvider({
    ...faux.provider,
    auth: { apiKey: envApiKeyAuth('Faux API key', ['STUDIO_FAUX_API_KEY']) },
  });
  return {
    gateway: createGateway(registry, ['faux'], options),
    setResponses: faux.setResponses,
    state: faux.state,
  };
}

export { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
