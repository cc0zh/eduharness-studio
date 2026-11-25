import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { assembleBlueprint } from './blueprints.js';
import type { IntakeAnswers } from './intake.js';
import {
  LessonScriptSchema,
  liveLessonKeypointCount,
  validateLessonScript,
} from './lesson-playback.js';
import type { CourseBlueprint, Keypoint, LessonRef } from './protocol.js';
import { DepthTagSchema } from './protocol.js';
import type { LessonTraceSpan } from './session-protocol.js';
import { type ModelGateway, ModelGenerationError } from './structured-model.js';
import { compileTeacherTurn } from './teacher-compiler.js';
import { normalizeReply, type TeacherTurnContext } from './teacher-context.js';
import {
  materializeTeacherGraph,
  modelGraphOptions,
  TeacherGraphEvidenceSchema,
} from './teacher-graph.js';
import { normalizeLessonOpening } from './teacher-normalize.js';
import { openingTurnPolicy } from './teacher-policy.js';
import { teacherSceneInstructions } from './teacher-prompt.js';
import { LessonBasisSchema, TeacherDiagnosisSchema } from './teacher-protocol.js';
import {
  calcVerifyTeacherTool,
  captureTeacherTools,
  type TeacherTool,
  teacherToolInstructions,
} from './teacher-tools.js';

const strict = { additionalProperties: false };
const short = (maxLength: number) => Type.String({ minLength: 1, maxLength });

const CourseOutlineSchema = Type.Object(
  {
    title: short(120),
    units: Type.Array(
      Type.Object(
        {
          title: short(100),
          lessons: Type.Array(
            Type.Object(
              {
                title: short(120),
                summary: short(300),
                depth: DepthTagSchema,
              },
              strict,
            ),
            { minItems: 1 },
          ),
        },
        strict,
      ),
      { minItems: 1 },
    ),
  },
  strict,
);

const KeypointDraftSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,64}$' }),
    title: short(48),
    objective: short(140),
    depth: DepthTagSchema,
  },
  strict,
);
const LessonDraftSchema = Type.Object(
  {
    keypoints: Type.Array(KeypointDraftSchema, liveLessonKeypointCount),
    basis: Type.Optional(LessonBasisSchema),
    opening: openingTurnPolicy.schema,
  },
  strict,
);

const LessonOpeningEvidenceSchema = Type.Object(
  {
    diagnosis: TeacherDiagnosisSchema,
    durationMs: Type.Number({ minimum: 0 }),
    guardrails: Type.Array(
      Type.Object(
        {
          attempt: Type.Integer({ minimum: 1, maximum: 3 }),
          reasons: Type.Array(short(220), { minItems: 1, maxItems: 20 }),
        },
        strict,
      ),
      { maxItems: 2 },
    ),
    graph: Type.Optional(TeacherGraphEvidenceSchema),
    tools: Type.Optional(
      Type.Array(
        Type.Object(
          {
            name: short(128),
            durationMs: Type.Number({ minimum: 0 }),
            input: Type.Optional(Type.Unknown()),
            result: Type.Optional(Type.Unknown()),
          },
          strict,
        ),
        { maxItems: 2 },
      ),
    ),
  },
  strict,
);
export type LessonOpeningEvidence = Static<typeof LessonOpeningEvidenceSchema>;

export const LessonMaterialSchema = Type.Object(
  {
    script: LessonScriptSchema,
    basis: Type.Optional(LessonBasisSchema),
    openingEvidence: Type.Optional(LessonOpeningEvidenceSchema),
  },
  strict,
);
export type LessonMaterial = Static<typeof LessonMaterialSchema>;

export function validateLessonMaterial(input: unknown): input is LessonMaterial {
  return Value.Check(LessonMaterialSchema, input) && validateLessonScript(input.script);
}

export function isLiveLessonMaterial(
  material: LessonMaterial | undefined,
): material is LessonMaterial & { openingEvidence: LessonOpeningEvidence } {
  // The new planning budget must not invalidate a previously accepted opening.
  return material?.openingEvidence !== undefined;
}

export function createCourseBlueprintPlanner(gateway: Pick<ModelGateway, 'generate'>) {
  return async function plan(id: string, answers: IntakeAnswers) {
    const result = await gateway.generate({
      schema: CourseOutlineSchema,
      maxTokens: 4096,
      prompt: [
        'Create a specific, concise, Chinese-language curriculum for this learner.',
        'Derive the number of units and lessons from this topic, prior knowledge and goal; do not copy a fixed outline or force a predetermined count.',
        'Each unit must have a title and at least one lesson with a concrete summary and depth tag.',
        `Learner calibration answers: ${JSON.stringify(answers)}`,
      ].join('\n'),
    });
    const blueprint = assembleBlueprint(
      { id, title: result.value.title, topic: answers.topic.trim() },
      result.value.units,
    );
    return { blueprint, durationMs: result.durationMs };
  };
}

type CourseLessonInput = {
  course: CourseBlueprint;
  lesson: LessonRef;
  previousKeypoints: readonly Keypoint[];
};

export class CourseLessonPlanningError extends Error {
  readonly code = 'course_lesson_invalid_output' as const;
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super('course_lesson_invalid_output');
    this.name = 'CourseLessonPlanningError';
    this.reasons = [...new Set(reasons)].slice(0, 8).map((reason) => reason.slice(0, 220));
  }
}

export function createCourseLessonPlanner(
  gateway: Pick<ModelGateway, 'generate'>,
  graphOptions = modelGraphOptions(gateway),
  tools: readonly TeacherTool[] = [calcVerifyTeacherTool],
) {
  return async function plan(input: CourseLessonInput) {
    const { course, lesson, previousKeypoints } = input;
    const guardrails: { attempt: number; reasons: string[] }[] = [];
    const spans: LessonTraceSpan[] = [];
    const captured = captureTeacherTools(tools, { generation: 1, step_id: 0 }, spans);
    let durationMs = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const toolBudget = attempt === 1 ? captured.maxToolCalls : 0;
      let result: { value: Static<typeof LessonDraftSchema>; durationMs: number };
      try {
        result = await gateway.generate({
          schema: LessonDraftSchema,
          normalizeOutput: normalizeLessonOpening,
          maxTokens: 4096,
          attempts: 1,
          tools: toolBudget ? captured.tools : [],
          maxToolCalls: toolBudget,
          prompt: [
            'Prepare one concise, Chinese-language whiteboard lesson with no external search.',
            `Return ONLY top-level keys keypoints (${liveLessonKeypointCount.minItems}–${liveLessonKeypointCount.maxItems} progressive items), optional basis, and opening. The nested opening uses the following output contract:`,
            'Give each point a distinct, topic-specific title and an observable objective. Follow one concrete problem from observation to application; never use generic study steps as point titles.',
            teacherSceneInstructions(openingTurnPolicy),
            teacherToolInstructions(tools, toolBudget),
            `Course: ${JSON.stringify({
              title: course.title,
              topic: course.topic,
              units: course.units.map(({ title, lessons }) => ({
                title,
                lessons: lessons.map(({ title, summary }) => ({ title, summary })),
              })),
            })}`,
            `Target lesson: ${JSON.stringify(lesson)}`,
            `Confirmed keypoints from preceding lessons: ${JSON.stringify(previousKeypoints.slice(-12))}`,
            captured.observations.length
              ? `工具结果：${JSON.stringify(captured.observations)}`
              : '',
            guardrails.length
              ? 'The previous submission was invalid. Rewrite the complete lesson using only the declared contract.'
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        });
      } catch (error) {
        if (!(error instanceof ModelGenerationError) || error.code !== 'model_invalid_output')
          throw error;
        durationMs += error.durationMs;
        const reasons = error.reasons.length
          ? error.reasons.map((reason) => `model_invalid_output: ${reason}`)
          : ['emit a complete LessonDraft matching the declared schema'];
        guardrails.push({ attempt, reasons });
        continue;
      }
      durationMs += result.durationMs;
      if (
        (['title', 'objective'] as const).some((field) => {
          const texts = result.value.keypoints.map((point) => normalizeReply(point[field]));
          return texts.some((text) => !text) || new Set(texts).size !== texts.length;
        })
      ) {
        guardrails.push({
          attempt,
          reasons: ['keypoint titles and objectives must be nonblank and distinct'],
        });
        continue;
      }
      const keypoints = result.value.keypoints.map((point, index) => ({
        ...point,
        status: index === 0 ? ('active' as const) : ('pending' as const),
      }));
      const opening: TeacherTurnContext = {
        topic: `${course.topic}：${lesson.title}`,
        keypoints,
        basis: result.value.basis,
        state: 'intake',
        played: [],
        input: { kind: 'opening' },
        progress: { highWater: 0, insertedCount: 0, lowEffortStreak: 0, truncatedCardIds: [] },
        generation: 1,
        seed: `${course.id}:${lesson.id}`,
      };
      const checked = compileTeacherTurn(opening, result.value.opening);
      if (!checked.ok) {
        guardrails.push({ attempt, reasons: checked.reasons.slice(0, 20) });
        continue;
      }
      const { actions, graph } = await materializeTeacherGraph(checked, graphOptions, true);
      const material: LessonMaterial = {
        script: { keypoints: checked.keypoints, actions },
        ...(result.value.basis ? { basis: result.value.basis } : {}),
        openingEvidence: {
          diagnosis: result.value.opening.diagnosis,
          durationMs: Math.max(0, durationMs - captured.durationMs),
          guardrails,
          ...(spans.length
            ? {
                tools: spans.map(({ name, durationMs, input, result }) => ({
                  name,
                  durationMs,
                  input,
                  result,
                })),
              }
            : {}),
          ...(graph ? { graph } : {}),
        },
      };
      return { material, durationMs };
    }
    throw new CourseLessonPlanningError(guardrails.flatMap(({ reasons }) => reasons));
  };
}
