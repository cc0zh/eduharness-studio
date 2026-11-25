import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { assembleBlueprint } from './blueprints.js';
import type { IntakeAnswers } from './intake.js';
import { LessonScriptSchema, validateLessonScript } from './lesson-playback.js';
import type { CourseBlueprint, Keypoint, LessonRef } from './protocol.js';
import { DepthTagSchema } from './protocol.js';
import { type ModelGateway, ModelGenerationError } from './structured-model.js';
import {
  materializeTeacherGraph,
  modelGraphOptions,
  TeacherGraphEvidenceSchema,
  teacherGraphInstruction,
} from './teacher-graph.js';
import {
  guardTeacherTurn,
  type TeacherTurnContext,
  teacherTextLimits,
} from './teacher-guardrails.js';
import {
  LessonBasisSchema,
  TeacherDiagnosisSchema,
  TeacherOpeningTurnSchema,
} from './teacher-protocol.js';

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
    keypoints: Type.Array(KeypointDraftSchema, { minItems: 2, maxItems: 6 }),
    basis: Type.Optional(LessonBasisSchema),
    opening: TeacherOpeningTurnSchema,
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
) {
  return async function plan(input: CourseLessonInput) {
    const { course, lesson, previousKeypoints } = input;
    const corrections: string[] = [];
    const guardrails: { attempt: number; reasons: string[] }[] = [];
    let durationMs = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let result: { value: Static<typeof LessonDraftSchema>; durationMs: number };
      try {
        result = await gateway.generate({
          schema: LessonDraftSchema,
          maxTokens: 4096,
          attempts: 1,
          prompt: [
            'Prepare one concise, Chinese-language whiteboard lesson with no external search.',
            'Return ONLY top-level keys keypoints (2–6 progressive items), optional basis, and opening. Inside opening, include ONLY diagnosis (status="opening", summary, strategy) and actions (4–8 unnumbered actions); omit unused optional fields and never add extra keys, null values, or step_id.',
            'Opening contract (hard): actions must end with exactly one ordinary ask as the final beat (without checkpoint). Do not add another ask or any keypoint outcome before the student has answered.',
            'Pedagogy & layout: never open with dry textbook definitions or "three elements" lists; open with a concrete failure case, counterintuitive conflict, or real problem. Use a clean left-to-right two-column layout (column 1 setup/tension -> column 2 mechanism/contrast table or diagram) instead of stacking every card into column 1.',
            'Keep all board and graph content complete but ≤280 characters; title ≤48; formula ≤140; speak ≤140; ask prompt ≤140; choice labels ≤56. Give all board/graph/ask cards unique IDs. Highlight only a prior board/graph card, quoting text in its content.',
            `Character budgets: ${JSON.stringify(teacherTextLimits)}`,
            teacherGraphInstruction,
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
            corrections.length
              ? `Rewrite the complete lesson payload (keypoints, optional basis, and opening) and fix these previous guardrail reasons: ${JSON.stringify(corrections)}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        });
      } catch (error) {
        if (!(error instanceof ModelGenerationError) || error.code !== 'model_invalid_output')
          throw error;
        const reasons = error.reasons.length
          ? error.reasons.map((reason) => `model_invalid_output: ${reason}`)
          : ['emit a complete LessonDraft matching the declared schema'];
        guardrails.push({ attempt, reasons });
        corrections.splice(0, corrections.length, ...reasons);
        continue;
      }
      durationMs += result.durationMs;
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
      const checked = guardTeacherTurn(opening, result.value.opening);
      if (!checked.ok) {
        guardrails.push({ attempt, reasons: checked.reasons.slice(0, 20) });
        corrections.splice(0, corrections.length, ...checked.reasons);
        continue;
      }
      const { actions, graph } = await materializeTeacherGraph(checked, graphOptions, true);
      const material: LessonMaterial = {
        script: { keypoints: checked.keypoints, actions },
        ...(result.value.basis ? { basis: result.value.basis } : {}),
        openingEvidence: {
          diagnosis: result.value.opening.diagnosis,
          durationMs,
          guardrails,
          ...(graph ? { graph } : {}),
        },
      };
      return { material, durationMs };
    }
    throw new CourseLessonPlanningError(guardrails.flatMap(({ reasons }) => reasons));
  };
}
