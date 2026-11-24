import { type Static, type TObject, type TProperties, type TSchema, Type } from '@sinclair/typebox';
import {
  BoardActionSchema,
  ChoiceAskActionSchema,
  DepthTagSchema,
  HighlightActionSchema,
  KeypointCompleteActionSchema,
  KeypointUnverifiedActionSchema,
  NewColumnActionSchema,
  NewPageActionSchema,
  OpenAskActionSchema,
  SpeakActionSchema,
} from './protocol.js';

const strict = { additionalProperties: false };
const short = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const draft = <P extends TProperties>(action: TObject<P>) => Type.Omit(action, ['step_id'], strict);

const DiagnosisSchema = Type.Object(
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
    summary: short(180),
    strategy: short(180),
  },
  strict,
);

const InsertKeypointSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,64}$' }),
    title: short(48),
    objective: short(140),
    depth: DepthTagSchema,
  },
  strict,
);

const commonDrafts = [
  draft(BoardActionSchema),
  draft(NewColumnActionSchema),
  draft(NewPageActionSchema),
  draft(HighlightActionSchema),
  draft(OpenAskActionSchema),
  draft(ChoiceAskActionSchema),
  draft(KeypointUnverifiedActionSchema),
] as const;

function turnSchema<T extends TSchema>(action: T) {
  return Type.Object(
    {
      diagnosis: DiagnosisSchema,
      insert_keypoint: Type.Optional(InsertKeypointSchema),
      actions: Type.Array(action, { minItems: 4, maxItems: 8 }),
    },
    strict,
  );
}

export const TeacherTurnWithoutMasterySchema = turnSchema(
  Type.Union([...commonDrafts, Type.Omit(SpeakActionSchema, ['step_id', 'checkpoint'], strict)]),
);

export const TeacherTurnOutputSchema = turnSchema(
  Type.Union([...commonDrafts, draft(SpeakActionSchema), draft(KeypointCompleteActionSchema)]),
);

export type TeacherTurnOutput = Static<typeof TeacherTurnOutputSchema>;
export type TeacherDiagnosis = Static<typeof DiagnosisSchema>;

export interface LessonBasis {
  objective: string;
  examples?: string[];
  misconceptions?: string[];
  sources?: { id: string; title: string; url?: string; snippet: string }[];
}

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
