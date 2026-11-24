import { Type } from '@sinclair/typebox';
import type { ModelCatalogEntry, ModelConnectionInput } from './model-protocol.js';

export const compatibleProvider = 'openai-compatible';

const connectionFields = {
  provider: Type.String({ minLength: 1, maxLength: 80 }),
  baseUrl: Type.Optional(Type.String()),
  apiKey: Type.Optional(Type.String({ maxLength: 4096 })),
};

export const ModelConnectionSchema = Type.Object(connectionFields, { additionalProperties: false });
export const ModelIdSchema = Type.String({ minLength: 1, maxLength: 240, pattern: '^[!-~]+$' });
export const ByokSchema = Type.Object(
  { ...connectionFields, modelId: ModelIdSchema },
  { additionalProperties: false },
);

export class ModelConfigError extends Error {
  constructor(
    public readonly code:
      | 'invalid_model_config'
      | 'invalid_base_url'
      | 'model_key_required'
      | 'model_list_unsupported',
  ) {
    super(code);
    this.name = 'ModelConfigError';
  }
}

export function normalizeBaseUrl(value?: string): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  try {
    if (
      input.length > 2048 ||
      !/^https?:\/\/[^/]/i.test(input) ||
      /[\s\\?#]/.test(input) ||
      [...input].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    ) {
      throw new ModelConfigError('invalid_base_url');
    }
    const url = new URL(input);
    if (!url.hostname || url.username || url.password)
      throw new ModelConfigError('invalid_base_url');
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    throw new ModelConfigError('invalid_base_url');
  }
}

// Reject reflection of a credential even if a URI path contains percent escapes.
export function containsCredential(value: string, apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  try {
    return value.includes(apiKey) || decodeURIComponent(value).includes(apiKey);
  } catch {
    return value.includes(apiKey);
  }
}

export function modelEndpoint(provider: ModelCatalogEntry, raw?: string) {
  const override = normalizeBaseUrl(raw);
  const baseUrl = override ?? provider.defaultBaseUrl;
  if (!baseUrl) throw new ModelConfigError('invalid_base_url');
  return { override, baseUrl };
}

interface SavedConnection {
  baseUrl: string;
  override?: string;
  apiKey?: string;
}

export function modelConnection(
  provider: ModelCatalogEntry,
  input: ModelConnectionInput,
  ...saved: (SavedConnection | undefined)[]
) {
  const { baseUrl, override } = modelEndpoint(provider, input.baseUrl ?? saved[0]?.override);
  const matching = saved.find((entry) => entry?.baseUrl === baseUrl && entry.apiKey);
  const apiKey = input.apiKey?.trim() || matching?.apiKey;
  if (
    override &&
    (containsCredential(override, apiKey) ||
      saved.some((entry) => containsCredential(override, entry?.apiKey)))
  ) {
    throw new ModelConfigError('invalid_base_url');
  }
  if (!apiKey) throw new ModelConfigError('model_key_required');
  if (!/^[!-~]+$/.test(apiKey)) throw new ModelConfigError('invalid_model_config');
  return { baseUrl, override, apiKey };
}
