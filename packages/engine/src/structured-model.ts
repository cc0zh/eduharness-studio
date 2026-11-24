import type { Static, TSchema } from '@sinclair/typebox';
import type { ModelCatalogEntry, ModelStatus } from './model-protocol.js';

export interface StructuredModelRequest<S extends TSchema> {
  schema: S;
  prompt: string;
  timeoutMs?: number;
  maxTokens?: number;
  /** A caller with its own correction loop can take ownership of retries. */
  attempts?: 1 | 2;
  tools?: readonly StructuredModelTool[];
  maxToolCalls?: number;
}

export interface StructuredModelTool {
  name: string;
  description: string;
  parameters: TSchema;
  run(input: unknown): unknown | Promise<unknown>;
}

export interface ModelGateway {
  getStatus(): Promise<ModelStatus>;
  getCatalog(): readonly ModelCatalogEntry[];
  setByok(credentials: unknown): boolean;
  clearByok(): void;
  modelListConnection(input: unknown): Promise<{ baseUrl: string; apiKey: string }>;
  generate<S extends TSchema>(
    request: StructuredModelRequest<S>,
  ): Promise<{ value: Static<S>; durationMs: number; toolCallsUsed?: number }>;
}

type FailureCode =
  | 'model_offline'
  | 'model_timeout'
  | 'model_request_failed'
  | 'model_invalid_output'
  | 'model_invalid_options';

export class ModelGenerationError extends Error {
  constructor(
    public readonly code: FailureCode,
    public readonly durationMs: number,
  ) {
    super(code);
    this.name = 'ModelGenerationError';
  }
}
