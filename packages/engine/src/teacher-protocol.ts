import { type Static, Type } from '@sinclair/typebox';

const strict = { additionalProperties: false };
export const teacherText = (maxLength: number, description?: string) =>
  Type.String({ pattern: '\\S', maxLength, ...(description ? { description } : {}) });

export const TeacherDiagnosisSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal('opening'),
      Type.Literal('mastered'),
      Type.Literal('misconception'),
      Type.Literal('missing_prereq'),
      Type.Literal('answer_seeking'),
      Type.Literal('low_effort'),
      Type.Literal('clarifying'),
    ]),
    summary: Type.String({ minLength: 1, maxLength: 180, description: '简要认知诊断。' }),
    strategy: Type.String({ minLength: 1, maxLength: 180, description: '简要教学决策。' }),
  },
  strict,
);

export type TeacherDiagnosis = Static<typeof TeacherDiagnosisSchema>;

const basisText = Type.String({ minLength: 1, maxLength: 400 });
export const LessonBasisSchema = Type.Object(
  {
    objective: Type.String({ minLength: 1, maxLength: 400 }),
    examples: Type.Optional(Type.Array(basisText, { maxItems: 8 })),
    misconceptions: Type.Optional(Type.Array(basisText, { maxItems: 8 })),
    sources: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ minLength: 1, maxLength: 100 }),
            title: Type.String({ minLength: 1, maxLength: 200 }),
            url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
            snippet: Type.String({ minLength: 1, maxLength: 500 }),
          },
          strict,
        ),
        { maxItems: 8 },
      ),
    ),
  },
  strict,
);
export type LessonBasis = Static<typeof LessonBasisSchema>;

export interface TeacherTurnTrace {
  generation: number;
  step_id: number;
  trigger: 'opening' | 'answer' | 'interrupt';
  diagnosis?: TeacherDiagnosis;
  inserted?: { id: string; title: string; before: string };
  unverified?: string;
  unverifiedStepId?: number;
  guardrails: { attempt: number; reasons: string[] }[];
  outcome: 'accepted' | 'rejected';
}
