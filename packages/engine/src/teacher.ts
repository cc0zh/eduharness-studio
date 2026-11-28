import type { PublicDialogueTurn } from './projection.js';
import type { LessonTraceSpan } from './session-protocol.js';
import { type ModelGateway, ModelGenerationError } from './structured-model.js';
import { type CompiledTeacherTurn, compileTeacherTurn } from './teacher-compiler.js';
import type { TeacherTurnContext } from './teacher-context.js';
import { materializeTeacherGraph, modelGraphOptions, teacherGraphSpan } from './teacher-graph.js';
import { normalizeTeacherTurn } from './teacher-normalize.js';
import { teacherTurnPolicy } from './teacher-policy.js';
import { teacherPrompt } from './teacher-prompt.js';
import type { TeacherTurnTrace } from './teacher-protocol.js';
import { maxTeacherAttempts, modelRejectionReasons } from './teacher-retry.js';
import { calcVerifyTeacherTool, captureTeacherTools, type TeacherTool } from './teacher-tools.js';

export { compileTeacherTurn } from './teacher-compiler.js';
export {
  effortSignal,
  type TeacherInput,
  type TeacherProgress,
  type TeacherTurnContext,
} from './teacher-context.js';
export { teacherGraphSpan } from './teacher-graph.js';
export { teacherBeatBudgetReason } from './teacher-pacing.js';
export { teacherTurnPolicy } from './teacher-policy.js';
export {
  type TeacherTurnOutput,
  TeacherTurnOutputSchema,
  type TurnPolicy,
} from './teacher-semantics.js';
export type { TeacherTool } from './teacher-tools.js';

export function createTeacherPlanner(
  gateway: Pick<ModelGateway, 'generate'>,
  tools: readonly TeacherTool[] = [calcVerifyTeacherTool],
  graphOptions = modelGraphOptions(gateway),
) {
  return async function plan(context: TeacherTurnContext, dialogue: readonly PublicDialogueTurn[]) {
    const anchor = { generation: context.generation, step_id: context.played.at(-1)?.step_id ?? 0 };
    const spans: LessonTraceSpan[] = [];
    const guardrails: TeacherTurnTrace['guardrails'] = [];
    const trace: TeacherTurnTrace = {
      ...anchor,
      trigger: context.input.kind,
      guardrails,
      outcome: 'rejected',
    };
    const policy = teacherTurnPolicy(context);
    const accepted = (checked: CompiledTeacherTurn, actions = checked.actions) => ({
      ok: true as const,
      actions,
      keypoints: checked.keypoints,
      initialState: checked.initialState,
      progress: checked.progress,
      trace: { ...trace, ...checked.trace, outcome: 'accepted' as const },
      spans,
    });
    const invalid = () => ({
      ok: false as const,
      failure: 'teacher_invalid_output' as const,
      trace,
      spans,
    });
    if (policy.phase === 'budget-close') {
      const checked = compileTeacherTurn(context);
      if (checked.ok) return accepted(checked);
      guardrails.push({ attempt: 1, reasons: checked.reasons });
      return invalid();
    }
    const captured = captureTeacherTools(tools, anchor, spans);

    for (let attempt = 1; attempt <= maxTeacherAttempts; attempt++) {
      const previousReasons = guardrails.at(-1)?.reasons ?? [];
      const attemptTools = captured.forAttempt(
        previousReasons,
        policy.phase !== 'first-low-effort' && policy.phase !== 'unverified',
      );
      const priorToolDurationMs = captured.durationMs;
      const modelSpan = (durationMs: number) =>
        spans.push({
          ...anchor,
          kind: 'model',
          name: 'teacher_turn',
          durationMs: Math.max(0, durationMs - (captured.durationMs - priorToolDurationMs)),
        });
      const prompt = teacherPrompt(
        context,
        policy,
        dialogue,
        attemptTools.tools,
        previousReasons,
        captured.observations,
        attemptTools.maxToolCalls,
      );
      let scene: unknown;
      try {
        const { value, durationMs } = await gateway.generate({
          schema: policy.schema,
          prompt,
          normalizeOutput: normalizeTeacherTurn,
          maxTokens: 4096,
          attempts: 1,
          ...attemptTools,
        });
        modelSpan(durationMs);
        scene = value;
      } catch (error) {
        const modelError = error instanceof ModelGenerationError ? error : undefined;
        const failure = modelError?.code ?? 'model_request_failed';
        modelSpan(modelError?.durationMs ?? 0);
        const reasons = modelError ? modelRejectionReasons(modelError) : [failure];
        guardrails.push({ attempt, reasons });
        if (failure !== 'model_invalid_output')
          return { ok: false as const, failure, trace, spans };
        continue;
      }
      const checked = compileTeacherTurn(context, scene);
      if (!checked.ok) {
        guardrails.push({ attempt, reasons: checked.reasons });
        continue;
      }
      const { actions, graph } = await materializeTeacherGraph(
        checked,
        graphOptions,
        policy.phase === 'opening',
      );
      if (graph) spans.push(teacherGraphSpan(anchor.generation, graph));
      return accepted(checked, actions);
    }
    return invalid();
  };
}

export type TeacherPlanner = ReturnType<typeof createTeacherPlanner>;
export type TeacherPlan = Awaited<ReturnType<TeacherPlanner>>;
