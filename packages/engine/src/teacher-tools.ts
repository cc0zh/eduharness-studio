import { Value } from '@sinclair/typebox/value';
import { CalcVerifyParamsSchema, CalcVerifyResultSchema, calcVerify } from './calc-verify.js';
import type { LessonTraceSpan } from './session-protocol.js';
import type { StructuredModelTool } from './structured-model.js';

export interface TeacherTool extends StructuredModelTool {
  traceInput?: (input: unknown) => unknown;
  traceResult?: (result: unknown) => unknown;
}

const secretKey = /(?:key|token|secret|password|credential|authorization|cookie)/i;
const mathNames = new Set([
  'pi',
  'e',
  'sqrt',
  'abs',
  'pow',
  'log',
  'ln',
  'exp',
  'sin',
  'cos',
  'tan',
  'floor',
  'ceil',
  'round',
  'min',
  'max',
  'comb',
  'perm',
  'C',
  'P',
]);

function mathExpression(value: string) {
  if (value.length > 512 || !/^[0-9A-Za-z_+*/^().,\s-]+$/.test(value)) return undefined;
  const names = value.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [];
  return names.every((name) => mathNames.has(name) || /^e\d+$/i.test(name)) ? value : undefined;
}

function calcTraceInput(input: unknown) {
  if (typeof input !== 'object' || input === null) return { expression: '[已隐藏]' };
  const fields = input as Record<string, unknown>;
  const expression = typeof fields.expression === 'string' ? fields.expression : undefined;
  const safeExpression = expression && mathExpression(expression);
  return {
    expression: safeExpression ?? '[已隐藏]',
    ...(expression && expression.length > 512 ? { length: expression.length } : {}),
    format: fields.format === 'fraction' ? 'fraction' : 'decimal',
  };
}

function calcTraceResult(result: unknown) {
  if (
    typeof result === 'object' &&
    result !== null &&
    'valid' in result &&
    result.valid === false
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: 'Arguments exceeded the bounded calc_verify schema.',
      },
    };
  }
  if (!Value.Check(CalcVerifyResultSchema, result)) {
    return { ok: false, error: { code: 'invalid_result' } };
  }
  if (result.ok) {
    return {
      ok: true,
      value: result.value,
      text: result.text,
      approximate: result.approximate,
    };
  }
  return {
    ok: false,
    error: {
      code: result.error.code,
      message: result.error.message,
      ...(result.error.position === undefined ? {} : { position: result.error.position }),
    },
  };
}

export const calcVerifyTeacherTool: TeacherTool = {
  name: 'calc_verify',
  description:
    'Safely evaluate a bounded arithmetic, fraction, or probability expression. Use when numerical verification or a counterexample helps; treat approximate=true as an estimate, never proof of exact equality.',
  parameters: CalcVerifyParamsSchema,
  run: calcVerify,
  traceInput: calcTraceInput,
  traceResult: calcTraceResult,
};

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

function projected(value: unknown, projection?: (value: unknown) => unknown): unknown {
  try {
    return projection?.(value) ?? safeTrace(value);
  } catch {
    return '[已隐藏]';
  }
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
    input: projected(input, tool.traceInput),
    result: projected(result, tool.traceResult),
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
    const observation = JSON.stringify(projected(result, tool.traceResult));
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
    return { observation, span: span(result) };
  } catch {
    return { error: `${tool.name} could not complete`, span: span({ valid: false }) };
  }
}
