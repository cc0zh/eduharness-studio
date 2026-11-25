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

// A request, not a playable graph. It carries complete alternative boardwork, never markup.
export const TeacherGraphDraftSchema = Type.Object(
  {
    ...Type.Omit(BoardActionSchema, ['step_id', 'title', 'type']).properties,
    type: Type.Literal('graph'),
    title: short(48),
    diagram_kind: Type.Union([
      Type.Literal('geometry'),
      Type.Literal('structure'),
      Type.Literal('distribution'),
    ]),
    description: short(240),
  },
  strict,
);
export type TeacherGraphDraft = Static<typeof TeacherGraphDraftSchema>;

const commonDrafts = [
  draft(BoardActionSchema),
  TeacherGraphDraftSchema,
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
      diagnosis: TeacherDiagnosisSchema,
      insert_keypoint: Type.Optional(InsertKeypointSchema),
      actions: Type.Array(action, { minItems: 4, maxItems: 8 }),
    },
    strict,
  );
}

export const TeacherTurnOutputSchema = turnSchema(
  Type.Union([...commonDrafts, draft(SpeakActionSchema), draft(KeypointCompleteActionSchema)]),
);

export type TeacherTurnSchemaPolicy = {
  insertKeypoint: boolean;
  keypointComplete: boolean;
  keypointUnverified: boolean;
  askCheckpoint: boolean;
  speakCheckpoint: boolean;
};

/** Create a strict subset of the structured-turn contract for one teaching phase. */
export function createTeacherTurnSchema(
  policy: TeacherTurnSchemaPolicy,
): typeof TeacherTurnOutputSchema {
  const actions: TSchema[] = [
    draft(BoardActionSchema),
    TeacherGraphDraftSchema,
    draft(NewColumnActionSchema),
    draft(NewPageActionSchema),
    draft(HighlightActionSchema),
    policy.askCheckpoint
      ? draft(OpenAskActionSchema)
      : Type.Omit(OpenAskActionSchema, ['step_id', 'checkpoint'], strict),
    policy.askCheckpoint
      ? draft(ChoiceAskActionSchema)
      : Type.Omit(ChoiceAskActionSchema, ['step_id', 'checkpoint'], strict),
    ...(policy.keypointUnverified ? [draft(KeypointUnverifiedActionSchema)] : []),
    policy.speakCheckpoint
      ? draft(SpeakActionSchema)
      : Type.Omit(SpeakActionSchema, ['step_id', 'checkpoint'], strict),
    ...(policy.keypointComplete ? [draft(KeypointCompleteActionSchema)] : []),
  ];
  const schema = Type.Object(
    {
      diagnosis: TeacherDiagnosisSchema,
      ...(policy.insertKeypoint ? { insert_keypoint: Type.Optional(InsertKeypointSchema) } : {}),
      actions: Type.Array(Type.Union(actions as [TSchema, ...TSchema[]]), {
        minItems: 4,
        maxItems: 8,
      }),
    },
    strict,
  );
  // Each runtime schema is a strict subset of TeacherTurnOutputSchema.
  return schema as unknown as typeof TeacherTurnOutputSchema;
}

export const TeacherOpeningTurnSchema = createTeacherTurnSchema({
  insertKeypoint: false,
  keypointComplete: false,
  keypointUnverified: false,
  askCheckpoint: false,
  speakCheckpoint: false,
});

export type TeacherTurnOutput = Static<typeof TeacherTurnOutputSchema>;
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
