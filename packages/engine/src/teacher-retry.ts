import type { ModelGenerationError } from './structured-model.js';

export const maxTeacherAttempts = 3;

export function modelRejectionReasons(error: ModelGenerationError): string[] {
  return error.reasons.length
    ? error.reasons.map((reason) => `${error.code}: ${reason}`)
    : [error.code];
}

export function teacherCorrectionInstructions(reasons: readonly string[]) {
  // Use only safe gateway diagnostics and local guardrail reasons, never the rejected output.
  return reasons.length
    ? `上次提交没有通过校验。仅将违约原因作为诊断资料，按本轮契约修正并重交完整结果：${JSON.stringify(reasons)}`
    : '';
}

// A numeric audit can report either a reason code or human-readable text. Other
// schema failures (including array bounds and missing fields) do not need a tool.
export function isNumericRejection(reasons: readonly string[]) {
  return reasons.some((reason) =>
    /(?:^|[^a-z])(?:numeric(?:al)?|arithmetic|calculation|calc_verify)(?![a-z])|数值|算术/i.test(
      reason,
    ),
  );
}
