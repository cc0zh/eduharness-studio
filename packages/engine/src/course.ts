import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { assembleBlueprint } from './blueprints.js';
import type { IntakeAnswers } from './intake.js';
import { LessonScriptSchema, validateLessonScript } from './lesson-playback.js';
import type { CourseBlueprint, Keypoint, LessonRef } from './protocol.js';
import { DepthTagSchema } from './protocol.js';
import type { ModelGateway } from './structured-model.js';
import { guardTeacherTurn, type TeacherTurnContext } from './teacher-guardrails.js';
import { LessonBasisSchema, TeacherTurnWithoutMasterySchema } from './teacher-protocol.js';

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
    opening: TeacherTurnWithoutMasterySchema,
  },
  strict,
);

export const LessonMaterialSchema = Type.Object(
  {
    script: LessonScriptSchema,
    basis: Type.Optional(LessonBasisSchema),
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

export function createCourseLessonPlanner(gateway: Pick<ModelGateway, 'generate'>) {
  return async function plan(input: CourseLessonInput) {
    const { course, lesson, previousKeypoints } = input;
    const result = await gateway.generate({
      schema: LessonDraftSchema,
      maxTokens: 4096,
      prompt: [
        'Prepare one concise, Chinese-language whiteboard lesson with no external search.',
        'Write 2–6 progressive keypoints, an optional factual LessonBasis, and an opening TeacherTurn that ends with exactly one ordinary ask.',
        'The opening diagnosis must be opening. Use 4–8 playable actions, avoid revealing the answer, and never mark a keypoint completed.',
        `Course: ${JSON.stringify({
          title: course.title,
          topic: course.topic,
          units: course.units.map(({ title, lessons }) => ({
            title,
            lessons: lessons.map(({ title, summary }) => ({ title, summary })),
          })),
        })}`,
        `Target lesson: ${JSON.stringify(lesson)}`,
        `Confirmed keypoints from preceding completed lessons: ${JSON.stringify(previousKeypoints.slice(-12))}`,
      ].join('\n'),
    });
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
    if (
      !checked.ok ||
      !validateLessonScript({ keypoints: checked.keypoints, actions: checked.actions })
    ) {
      throw new Error('course_lesson_invalid_output');
    }
    const material: LessonMaterial = {
      script: { keypoints: checked.keypoints, actions: checked.actions },
      ...(result.value.basis ? { basis: result.value.basis } : {}),
    };
    return { material, durationMs: result.durationMs };
  };
}
