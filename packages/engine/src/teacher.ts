import type { PublicDialogueTurn } from './projection.js';
import type { LessonTraceSpan } from './session-protocol.js';
import type { StructuredModelTool } from './structured-model.js';
import { type ModelGateway, ModelGenerationError } from './structured-model.js';
import { guardTeacherTurn, type TeacherTurnContext } from './teacher-guardrails.js';
import { teacherPrompt } from './teacher-prompt.js';
import { TeacherTurnOutputSchema, type TeacherTurnTrace } from './teacher-protocol.js';
import { calcVerifyTeacherTool, runTeacherTool, type TeacherTool } from './teacher-tools.js';

export type { TeacherInput, TeacherProgress, TeacherTurnContext } from './teacher-guardrails.js';
export { effortSignal } from './teacher-guardrails.js';
export { type TeacherTurnOutput, TeacherTurnOutputSchema } from './teacher-protocol.js';
export type { TeacherTool } from './teacher-tools.js';

const maxCorrections = 2;
const maxToolSteps = 2;

export function createTeacherPlanner(
  gateway: Pick<ModelGateway, 'generate'>,
  tools: readonly TeacherTool[] = [calcVerifyTeacherTool],
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
    let reasons: string[] = [];

    for (let attempt = 1; attempt <= maxCorrections + 1; attempt++) {
      const toolBudget = Math.max(
        0,
        Math.min(maxToolSteps - toolCallsUsed, tools.length ? maxToolSteps : 0),
      );
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
              const observation =
                result.observation ?? JSON.stringify({ error: result.error ?? 'tool failed' });
              observations.push({ tool: tool.name, result: observation });
              return observation;
            },
          }))
        : [];
      try {
        const { value, durationMs } = await gateway.generate({
          schema: TeacherTurnOutputSchema,
          prompt,
          maxTokens: 4096,
          attempts: 1,
          tools: modelTools,
          maxToolCalls: toolBudget,
        });
        spans.push({ ...anchor, kind: 'model', name: 'teacher_turn', durationMs });
        const checked = guardTeacherTurn(context, value);
        if (checked.ok) {
          return {
            ...checked,
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
          durationMs: modelError?.durationMs ?? 0,
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
      }
      guardrails.push({ attempt, reasons });
    }
    return { ok: false as const, failure: 'teacher_invalid_output' as const, trace, spans };
  };
}

export type TeacherPlanner = ReturnType<typeof createTeacherPlanner>;
export type TeacherPlan = Awaited<ReturnType<TeacherPlanner>>;
