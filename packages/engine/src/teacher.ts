import type { PublicDialogueTurn } from './projection.js';
import type { LessonTraceSpan } from './session-protocol.js';
import { type ModelGateway, ModelGenerationError } from './structured-model.js';
import { compileTeacherTurn } from './teacher-compiler.js';
import type { TeacherTurnContext } from './teacher-context.js';
import { materializeTeacherGraph, modelGraphOptions, teacherGraphSpan } from './teacher-graph.js';
import { normalizeTeacherTurn } from './teacher-normalize.js';
import { teacherTurnPolicy } from './teacher-policy.js';
import { teacherPrompt } from './teacher-prompt.js';
import type { TeacherTurnTrace } from './teacher-protocol.js';
import { calcVerifyTeacherTool, captureTeacherTools, type TeacherTool } from './teacher-tools.js';

export { compileTeacherTurn } from './teacher-compiler.js';
export {
  effortSignal,
  type TeacherInput,
  type TeacherProgress,
  type TeacherTurnContext,
} from './teacher-context.js';
export { teacherGraphSpan } from './teacher-graph.js';
export { teacherTurnPolicy } from './teacher-policy.js';
export {
  type TeacherTurnOutput,
  TeacherTurnOutputSchema,
  type TurnPolicy,
} from './teacher-semantics.js';
export type { TeacherTool } from './teacher-tools.js';

const maxCorrections = 2;

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
    const captured = captureTeacherTools(tools, anchor, spans);

    for (let attempt = 1; attempt <= maxCorrections + 1; attempt++) {
      const toolBudget =
        attempt === 1 && policy.phase !== 'first-low-effort' && policy.phase !== 'unverified'
          ? captured.maxToolCalls
          : 0;
      const modelSpan = (durationMs: number) =>
        spans.push({
          ...anchor,
          kind: 'model',
          name: 'teacher_turn',
          durationMs: Math.max(0, durationMs - (toolBudget ? captured.durationMs : 0)),
        });
      const prompt = teacherPrompt(
        context,
        policy,
        dialogue,
        tools,
        attempt > 1,
        captured.observations,
        toolBudget,
      );
      let scene: unknown;
      try {
        const { value, durationMs } = await gateway.generate({
          schema: policy.schema,
          prompt,
          normalizeOutput: normalizeTeacherTurn,
          maxTokens: 4096,
          attempts: 1,
          tools: toolBudget ? captured.tools : [],
          maxToolCalls: toolBudget,
        });
        modelSpan(durationMs);
        scene = value;
      } catch (error) {
        const modelError = error instanceof ModelGenerationError ? error : undefined;
        const failure = modelError?.code ?? 'model_request_failed';
        modelSpan(modelError?.durationMs ?? 0);
        const reasons = modelError?.reasons.length
          ? modelError.reasons.map((reason) => `model_invalid_output: ${reason}`)
          : [failure];
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
      return {
        ok: true as const,
        actions,
        keypoints: checked.keypoints,
        initialState: checked.initialState,
        progress: checked.progress,
        trace: { ...trace, ...checked.trace, outcome: 'accepted' as const },
        spans,
      };
    }
    return { ok: false as const, failure: 'teacher_invalid_output' as const, trace, spans };
  };
}

export type TeacherPlanner = ReturnType<typeof createTeacherPlanner>;
export type TeacherPlan = Awaited<ReturnType<TeacherPlanner>>;
