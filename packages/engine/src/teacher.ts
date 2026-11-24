import { Type } from '@sinclair/typebox';
import type { PublicDialogueTurn } from './projection.js';
import type { LessonTraceSpan } from './session-protocol.js';
import { type ModelGateway, ModelGenerationError } from './structured-model.js';
import { guardTeacherTurn, type TeacherTurnContext } from './teacher-guardrails.js';
import { teacherPrompt } from './teacher-prompt.js';
import { TeacherTurnOutputSchema, type TeacherTurnTrace } from './teacher-protocol.js';
import { runTeacherTool, type TeacherTool, TeacherToolCallSchema } from './teacher-tools.js';

export type { TeacherInput, TeacherProgress, TeacherTurnContext } from './teacher-guardrails.js';
export { effortSignal } from './teacher-guardrails.js';
export { type TeacherTurnOutput, TeacherTurnOutputSchema } from './teacher-protocol.js';
export type { TeacherTool } from './teacher-tools.js';

const maxCorrections = 2;
const maxToolSteps = 2;

export function createTeacherPlanner(
  gateway: Pick<ModelGateway, 'generate'>,
  tools: readonly TeacherTool[] = [],
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
    let toolBudget = tools.length ? maxToolSteps : 0;
    let reasons: string[] = [];

    for (let attempt = 1; attempt <= maxCorrections + 1; attempt++) {
      const prompt = teacherPrompt(context, dialogue, tools, reasons, observations, toolBudget);
      const schema = toolBudget
        ? Type.Union([TeacherTurnOutputSchema, TeacherToolCallSchema])
        : TeacherTurnOutputSchema;
      try {
        const { value, durationMs } = await gateway.generate({
          schema,
          prompt,
          maxTokens: 4096,
          attempts: 1,
        });
        spans.push({ ...anchor, kind: 'model', name: 'teacher_turn', durationMs });
        if ('tool' in value) {
          --toolBudget;
          const tool = tools.find(({ name }) => name === value.tool);
          if (tool) {
            const result = await runTeacherTool(tool, value.arguments, anchor);
            spans.push(result.span);
            if (result.observation !== undefined) {
              observations.push({ tool: tool.name, result: result.observation });
              // A successful tool step extends the current attempt, not the correction budget.
              --attempt;
              continue;
            }
            reasons = [result.error ?? 'tool did not return a result'];
          } else {
            reasons = ['tool is not registered for this lesson'];
          }
        } else {
          const checked = guardTeacherTurn(context, value);
          if (checked.ok) {
            return {
              ...checked,
              trace: { ...trace, ...checked.trace, outcome: 'accepted' as const },
              spans,
            };
          }
          reasons = checked.reasons;
        }
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
          'emit one structured result with diagnosis and 4–8 unnumbered actions of the declared schema, or one tool call when available',
        ];
      }
      guardrails.push({ attempt, reasons });
    }
    return { ok: false as const, failure: 'teacher_invalid_output' as const, trace, spans };
  };
}

export type TeacherPlanner = ReturnType<typeof createTeacherPlanner>;
export type TeacherPlan = Awaited<ReturnType<TeacherPlanner>>;
