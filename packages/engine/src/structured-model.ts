import type { Static, TSchema } from '@sinclair/typebox';
import type { ModelCatalogEntry, ModelStatus } from './model-protocol.js';

export const structuredOutputTool = 'emit_result';
export const maxStructuredAttempts = 2;

export interface StructuredModelRequest<S extends TSchema> {
  schema: S;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxTokens?: number;
  /** A caller with its own correction loop can take ownership of retries. */
  attempts?: 1 | 2;
  /** Cheap, request-local syntax cleanup before strict output validation. */
  normalizeOutput?: (value: unknown) => unknown;
  tools?: readonly StructuredModelTool[];
  maxToolCalls?: number;
}

export function validModelRequestBudget({
  timeoutMs,
  maxTokens,
  attempts,
  tools,
  maxToolCalls,
}: Required<
  Pick<
    StructuredModelRequest<TSchema>,
    'timeoutMs' | 'maxTokens' | 'attempts' | 'tools' | 'maxToolCalls'
  >
>): boolean {
  return (
    Number.isSafeInteger(timeoutMs) &&
    timeoutMs >= 1 &&
    timeoutMs <= 60_000 &&
    Number.isSafeInteger(maxTokens) &&
    maxTokens >= 1 &&
    (attempts === 1 || attempts === maxStructuredAttempts) &&
    Number.isSafeInteger(maxToolCalls) &&
    maxToolCalls >= 0 &&
    maxToolCalls <= 2 &&
    (maxToolCalls === 0 || tools.length > 0) &&
    tools.every(({ name }) => name && name !== structuredOutputTool) &&
    new Set(tools.map(({ name }) => name)).size === tools.length
  );
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
    /** Safe diagnostics only: no provider text, rejected values or credentials. */
    public readonly reasons: readonly string[] = [],
  ) {
    super(code);
    this.name = 'ModelGenerationError';
  }
}
