// Public, browser-safe DTOs. No SDK models, credentials or provider options cross HTTP.
export type ModelStatus =
  | { mode: 'offline'; provider: null; modelId: null; source: 'none' }
  | { mode: 'live'; provider: string; modelId: string; source: 'env' | 'byok' };

export interface ModelCatalogEntry {
  id: string;
  name: string;
  models: ReadonlyArray<{ id: string; name: string }>;
}

export type ModelSettings = ModelStatus & { providers: readonly ModelCatalogEntry[] };
