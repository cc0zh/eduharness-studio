import type { PublicDialogueTurn } from './projection.js';
import type { LessonTraceSpan } from './session-protocol.js';
import type { StructuredModelTool } from './structured-model.js';
import { type ModelGateway, ModelGenerationError } from './structured-model.js';
import { materializeTeacherGraph, modelGraphOptions, teacherGraphSpan } from './teacher-graph.js';
import {
  guardTeacherTurn,
  type TeacherTurnContext,
  teacherAnswerEvidence,
} from './teacher-guardrails.js';
import { teacherPrompt } from './teacher-prompt.js';
import {
  TeacherTurnOutputSchema,
  type TeacherTurnTrace,
  TeacherTurnWithoutMasterySchema,
} from './teacher-protocol.js';
import { calcVerifyTeacherTool, runTeacherTool, type TeacherTool } from './teacher-tools.js';

export { teacherGraphSpan } from './teacher-graph.js';
export type { TeacherInput, TeacherProgress, TeacherTurnContext } from './teacher-guardrails.js';
export { effortSignal } from './teacher-guardrails.js';
export { type TeacherTurnOutput, TeacherTurnOutputSchema } from './teacher-protocol.js';
export type { TeacherTool } from './teacher-tools.js';

const maxCorrections = 2;
const maxToolSteps = 2;

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
    const observations: { tool: string; result: string }[] = [];
    let toolCallsUsed = 0;
    let toolDurationMs = 0;
    let reasons: string[] = [];
    const { effort, canAssessMastery } = teacherAnswerEvidence(context);
    const schema = canAssessMastery ? TeacherTurnOutputSchema : TeacherTurnWithoutMasterySchema;
    const toolLimit = !effort && tools.length ? maxToolSteps : 0;

    for (let attempt = 1; attempt <= maxCorrections + 1; attempt++) {
      const toolBudget = Math.max(0, toolLimit - toolCallsUsed);
      const prompt = teacherPrompt(context, dialogue, tools, reasons, observations, toolBudget);
      const modelTools: StructuredModelTool[] = toolBudget
        ? tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            run: async (input) => {
              toolCallsUsed++;
              const result = await runTeacherTool(tool, input, anchor);
              spans.push(result.span);
              toolDurationMs += result.span.durationMs;
              const observation =
                result.observation ?? JSON.stringify({ error: result.error ?? 'tool failed' });
              observations.push({ tool: tool.name, result: observation });
              return observation;
            },
          }))
        : [];
      const toolsBeforeAttempt = toolDurationMs;
      try {
        const { value, durationMs } = await gateway.generate({
          schema,
          prompt,
          maxTokens: 4096,
          attempts: 1,
          tools: modelTools,
          maxToolCalls: toolBudget,
        });
        spans.push({
          ...anchor,
          kind: 'model',
          name: 'teacher_turn',
          durationMs: Math.max(0, durationMs - (toolDurationMs - toolsBeforeAttempt)),
        });
        const checked = guardTeacherTurn(context, value);
        if (checked.ok) {
          const { actions, graph } = await materializeTeacherGraph(
            checked,
            graphOptions,
            context.input.kind === 'opening',
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
        reasons = checked.reasons;
      } catch (error) {
        const modelError = error instanceof ModelGenerationError ? error : undefined;
        spans.push({
          ...anchor,
          kind: 'model',
          name: 'teacher_turn',
          durationMs: Math.max(
            0,
            (modelError?.durationMs ?? 0) - (toolDurationMs - toolsBeforeAttempt),
          ),
        });
        if (modelError?.code !== 'model_invalid_output') {
          guardrails.push({ attempt, reasons: [modelError?.code ?? 'model_request_failed'] });
          return {
            ok: false as const,
            failure: modelError?.code ?? 'model_request_failed',
            trace,
            spans,
          };
        }
        reasons = [
          'emit one structured result with diagnosis and 4–8 unnumbered actions of the declared schema',
        ];
        if (!canAssessMastery) {
          reasons.push(
            'omit keypoint_complete and speak.checkpoint until a verify ask is substantively answered',
          );
        }
      }
      guardrails.push({ attempt, reasons });
    }
    return { ok: false as const, failure: 'teacher_invalid_output' as const, trace, spans };
  };
}

export type TeacherPlanner = ReturnType<typeof createTeacherPlanner>;
export type TeacherPlan = Awaited<ReturnType<TeacherPlanner>>;
