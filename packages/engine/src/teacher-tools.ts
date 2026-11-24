import { type TSchema, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { LessonTraceSpan } from './session-protocol.js';

export interface TeacherTool {
  name: string;
  description: string;
  parameters: TSchema;
  run: (input: unknown) => unknown;
}

export const TeacherToolCallSchema = Type.Object(
  { tool: Type.String({ minLength: 1, maxLength: 64 }), arguments: Type.Unknown() },
  { additionalProperties: false },
);

const secretKey = /(?:key|token|secret|password|credential|authorization|cookie)/i;

// Tool traces are a bounded projection of numeric facts, not a second copy of arbitrary text.
function safeTrace(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return '[已隐藏]';
  if (depth >= 2 || typeof value !== 'object' || !value) return undefined;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => safeTrace(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => /^[a-z][a-z_]{0,23}$/i.test(key) && !secretKey.test(key))
      .slice(0, 8)
      .map(([key, item]) => [key, safeTrace(item, depth + 1)]),
  );
}

export async function runTeacherTool(
  tool: TeacherTool,
  input: unknown,
  anchor: Pick<LessonTraceSpan, 'generation' | 'step_id'>,
) {
  const started = performance.now();
  const span = (result: unknown): LessonTraceSpan => ({
    ...anchor,
    kind: 'tool',
    name: tool.name,
    durationMs: Math.round(performance.now() - started),
    input: safeTrace(input),
    result,
  });
  try {
    if (!Value.Check(tool.parameters, input)) {
      return {
        error: `arguments did not match the ${tool.name} schema`,
        span: span({ valid: false }),
      };
    }
    const result: unknown = await tool.run(input);
    const raw = JSON.stringify(result);
    const observation = JSON.stringify(safeTrace(result));
    if (
      raw === undefined ||
      raw.length > 2048 ||
      observation === undefined ||
      observation.length > 2048
    ) {
      return {
        error: `${tool.name} returned no bounded JSON result`,
        span: span({ valid: false }),
      };
    }
    return { observation, span: span(safeTrace(result)) };
  } catch {
    return { error: `${tool.name} could not complete`, span: span({ valid: false }) };
  }
}
