import {
  type Api,
  createModels,
  createProvider,
  envApiKeyAuth,
  fauxProvider,
  type Message,
  type Model,
  type Models,
  type Tool,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  ByokSchema,
  compatibleProvider,
  containsCredential,
  ModelConfigError,
  ModelConnectionSchema,
  ModelIdSchema,
  modelAuthContext,
  modelConnection,
  modelEndpoint,
  modelListProviders,
  modelProviderIds,
  normalizeBaseUrl,
} from './model-configuration.js';
import type { ModelCatalogEntry } from './model-protocol.js';
import { type ModelGateway, ModelGenerationError } from './structured-model.js';
import {
  redactToolCallArguments,
  runStructuredModelLoop,
  type StructuredToolCall,
} from './structured-model-loop.js';

export {
  type ModelGateway,
  ModelGenerationError,
  type StructuredModelRequest,
  type StructuredModelTool,
} from './structured-model.js';

const outputTool = 'emit_result';
const maxAttempts = 2;
const maxToolCallLimit = 2;

export interface ModelGatewayOptions {
  provider?: string;
  modelId?: string;
  baseUrl?: string;
  readEnv?: (name: string) => string | undefined;
  fetch?: typeof globalThis.fetch;
}

type Selection = {
  model: Model<Api>;
  baseUrl: string;
  source: 'env' | 'byok';
  override?: string;
  apiKey?: string;
};

function resolveModel(
  registry: Models,
  provider: string,
  id: string,
  { baseUrl, override }: { baseUrl: string; override?: string },
): Model<Api> {
  const preset = registry.getModel(provider, id);
  if (preset) {
    if (provider === 'openrouter' && preset.api === 'anthropic-messages') {
      return override ? { ...preset, baseUrl: override.replace(/\/v1$/, '') } : preset;
    }
    return override ? { ...preset, baseUrl: override } : preset;
  }
  const api =
    provider === compatibleProvider || provider === 'openrouter'
      ? 'openai-completions'
      : registry.getModels(provider)[0]?.api;
  if (!modelProviderIds.includes(provider) || !api)
    throw new ModelConfigError('invalid_model_config');
  return {
    id,
    name: id,
    provider,
    api,
    baseUrl,
    reasoning: false,
    input: ['text'],
    contextWindow: 8192,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

async function selectFromEnv(
  registry: Models,
  catalog: readonly ModelCatalogEntry[],
  options: ModelGatewayOptions,
) {
  const providerId = options.provider || (options.baseUrl ? compatibleProvider : undefined);
  for (const provider of catalog) {
    if (providerId && provider.id !== providerId) continue;
    const modelId = options.modelId || provider.models[0]?.id;
    if (!modelId || !Value.Check(ModelIdSchema, modelId)) continue;
    if (!providerId && !registry.getModel(provider.id, modelId)) continue;
    try {
      // The studio providers resolve env auth locally, without contacting their endpoint.
      const auth = await registry.getAuth(provider.id);
      if (!auth) continue;
      const { override, baseUrl } = modelEndpoint(provider, options.baseUrl);
      const apiKey = auth.auth.apiKey;
      if ((override && containsCredential(override, apiKey)) || containsCredential(modelId, apiKey))
        continue;
      const model = resolveModel(registry, provider.id, modelId, { baseUrl, override });
      return { model, baseUrl, override, apiKey, source: 'env' } satisfies Selection;
    } catch {
      // Bad env configuration must leave the offline classroom usable.
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
    if (!provider) return [];
    return [
      {
        id,
        name: provider.name,
        models,
        defaultBaseUrl: normalizeBaseUrl(provider.baseUrl ?? registry.getModels(id)[0]?.baseUrl),
        requiresBaseUrl: id === compatibleProvider,
        supportsModelList: modelListProviders.has(id),
      },
    ];
  });
  const envSelection = selectFromEnv(registry, catalog, options);
  let byok: Selection | undefined;
  const transport = options.fetch ?? globalThis.fetch;
  function requireProvider(id: string) {
    const provider = catalog.find((entry) => entry.id === id);
    if (!provider) throw new ModelConfigError('invalid_model_config');
    return provider;
  }
  async function select(): Promise<Selection | undefined> {
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
            ...(selected.override && { baseUrl: selected.override }),
          }
        : { mode: 'offline', provider: null, modelId: null, source: 'none' };
    },
    getCatalog: () => catalog,
    setByok(credentials) {
      if (!Value.Check(ByokSchema, credentials)) throw new ModelConfigError('invalid_model_config');
      const provider = requireProvider(credentials.provider);
      const saved = byok?.model.provider === provider.id ? byok : undefined;
      const { baseUrl, apiKey, override } = modelConnection(provider, credentials, saved);
      if (override && containsCredential(override, byok?.apiKey)) {
        throw new ModelConfigError('invalid_base_url');
      }
      if (
        containsCredential(credentials.modelId, apiKey) ||
        containsCredential(credentials.modelId, byok?.apiKey)
      ) {
        throw new ModelConfigError('invalid_model_config');
      }
      const model = resolveModel(registry, provider.id, credentials.modelId, { baseUrl, override });
      byok = { model, baseUrl, source: 'byok', apiKey, override };
      return true;
    },
    clearByok() {
      byok = undefined;
    },
    async modelListConnection(input) {
      if (!Value.Check(ModelConnectionSchema, input))
        throw new ModelConfigError('invalid_model_config');
      const provider = requireProvider(input.provider);
      if (!provider.supportsModelList) throw new ModelConfigError('model_list_unsupported');
      const saved = [byok, await envSelection].filter(
        (entry) => entry?.model.provider === provider.id,
      );
      const { baseUrl, apiKey } = modelConnection(provider, input, ...saved);
      return { baseUrl, apiKey };
    },
    async generate({
      schema,
      prompt,
      timeoutMs = 30_000,
      maxTokens = 2048,
      attempts = maxAttempts,
      tools = [],
      maxToolCalls: toolLimit = 0,
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
        (attempts !== 1 && attempts !== maxAttempts) ||
        !Number.isSafeInteger(toolLimit) ||
        toolLimit < 0 ||
        toolLimit > maxToolCallLimit ||
        (toolLimit > 0 && tools.length === 0) ||
        tools.some(({ name }) => !name || name === outputTool) ||
        new Set(tools.map(({ name }) => name)).size !== tools.length
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
        const initialMessages: Message[] = [
          { role: 'user', content: prompt, timestamp: Date.now() },
        ];
        const result = await Promise.race([
          runStructuredModelLoop({
            schema,
            messages: initialMessages,
            tools,
            toolLimit,
            attempts,
            output: {
              name: outputTool,
              description: 'Return the structured result.',
              parameters: Type.Object({ value: schema }, { additionalProperties: false }),
            },
            complete: async ({ messages, tools: definitions, correction }) => {
              const sdkTools: Tool[] = definitions.map(({ name, description, parameters }) => ({
                name,
                description,
                parameters,
              }));
              const response = await registry.completeSimple(
                model,
                {
                  systemPrompt: `Return exactly one ${outputTool} call for the final structured result. Use a declared tool when it helps numeric verification. ${correction ? 'Correct the previous output or tool use.' : ''}`,
                  messages: [...messages],
                  tools: sdkTools,
                },
                {
                  apiKey: selected.source === 'byok' ? selected.apiKey : undefined,
                  fetch: (input, init) => transport(input, { ...init, redirect: 'error' }),
                  maxTokens: Math.min(maxTokens, model.maxTokens),
                  maxRetries: 0,
                  signal: controller.signal,
                  timeoutMs,
                },
              );
              if (controller.signal.aborted) throw fail('model_timeout');
              if (!['toolUse', 'stop', 'length'].includes(response.stopReason)) {
                throw fail('model_request_failed');
              }
              return {
                message: response,
                stopReason: response.stopReason,
                calls: response.content.flatMap((part): StructuredToolCall[] =>
                  part.type === 'toolCall'
                    ? [{ id: part.id, name: part.name, arguments: part.arguments }]
                    : [],
                ),
              };
            },
            appendToolResult: (call, content, isError): Message => ({
              role: 'toolResult',
              toolCallId: call.id,
              toolName: call.name,
              content: [{ type: 'text', text: content }],
              isError,
              timestamp: Date.now(),
            }),
            redactToolArguments: redactToolCallArguments,
          }),
          deadline,
        ]);
        if (!result) throw fail('model_invalid_output');
        return {
          value: result.value,
          durationMs: elapsed(),
          ...(tools.length ? { toolCallsUsed: result.toolCallsUsed } : {}),
        };
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
  const registry = builtinModels({ authContext: modelAuthContext(options.readEnv) });
  registry.setProvider(
    createProvider({
      id: compatibleProvider,
      name: '自定义 OpenAI 格式',
      models: [],
      auth: { apiKey: envApiKeyAuth('OpenAI-compatible API key', ['OPENAI_COMPATIBLE_API_KEY']) },
      api: openAICompletionsApi(),
    }),
  );
  return createGateway(registry, modelProviderIds, options);
}

/** A separate SDK registry with no network providers, for deterministic tests. */
export function createFauxModelGateway(options: ModelGatewayOptions = {}) {
  const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }, { id: 'faux-2' }] });
  const registry = createModels({ authContext: modelAuthContext(options.readEnv) });
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
export { containsCredential, ModelConfigError, ModelIdSchema } from './model-configuration.js';
