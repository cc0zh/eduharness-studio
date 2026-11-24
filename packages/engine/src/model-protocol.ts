// Public, browser-safe DTOs. No SDK models, credentials or provider options cross HTTP.
export type ModelStatus =
  | { mode: 'offline'; provider: null; modelId: null; source: 'none' }
  | { mode: 'live'; provider: string; modelId: string; source: 'env' | 'byok'; baseUrl?: string };

export interface ModelChoice {
  id: string;
  name: string;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  models: readonly ModelChoice[];
  defaultBaseUrl?: string;
  requiresBaseUrl: boolean;
  supportsModelList: boolean;
}

export type ModelSettings = ModelStatus & { providers: readonly ModelCatalogEntry[] };

export interface ModelConnectionInput {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
}

export type ByokInput = ModelConnectionInput & { modelId: string };
