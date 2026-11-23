import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { sanitizeSvg } from './static-svg.js';

export const PROTOCOL_VERSION = '0.1.0';

export const DepthTagSchema = Type.Union([
  Type.Literal('intuition'),
  Type.Literal('definition'),
  Type.Literal('derivation'),
  Type.Literal('theory'),
  Type.Literal('application'),
]);
export type DepthTag = Static<typeof DepthTagSchema>;

// Keep the published protocol able to read historic 4+ column snapshots.
const BoardColumnSchema = Type.Integer({ minimum: 1 });
const FormulaSchema = Type.Optional(Type.String({ minLength: 1 }));

export const BoardActionSchema = Type.Object({
  type: Type.Literal('board'),
  step_id: Type.Integer({ minimum: 1 }),
  column: BoardColumnSchema,
  card_id: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String({ minLength: 1 })),
  depth: Type.Optional(DepthTagSchema),
  content: Type.String({ minLength: 1 }),
  formula: FormulaSchema,
});

export const NewColumnActionSchema = Type.Object({
  type: Type.Literal('new_column'),
  step_id: Type.Integer({ minimum: 1 }),
  column: BoardColumnSchema,
});

export const NewPageActionSchema = Type.Object({
  type: Type.Literal('new_page'),
  step_id: Type.Integer({ minimum: 1 }),
  page_id: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String({ minLength: 1 })),
});

export const HighlightActionSchema = Type.Object({
  type: Type.Literal('highlight'),
  step_id: Type.Integer({ minimum: 1 }),
  card_id: Type.String({ minLength: 1 }),
  target_text: Type.String({ minLength: 1 }),
  style: Type.Union([Type.Literal('highlight'), Type.Literal('circle')]),
});

export const GraphDiagramSchema = Type.Object(
  {
    nodes: Type.Array(
      Type.Object(
        { id: Type.String({ minLength: 1 }), label: Type.String({ minLength: 1 }) },
        {
          additionalProperties: false,
        },
      ),
      { minItems: 1 },
    ),
    edges: Type.Array(
      Type.Object(
        {
          from: Type.String({ minLength: 1 }),
          to: Type.String({ minLength: 1 }),
          label: Type.Optional(Type.String({ minLength: 1 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const GraphActionSchema = Type.Object({
  type: Type.Literal('graph'),
  step_id: Type.Integer({ minimum: 1 }),
  column: BoardColumnSchema,
  card_id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  depth: Type.Optional(DepthTagSchema),
  svg_markup: Type.String({ minLength: 1 }),
  formula: FormulaSchema,
  diagram: Type.Optional(GraphDiagramSchema),
});

export const SpeakActionSchema = Type.Object({
  type: Type.Literal('speak'),
  step_id: Type.Integer({ minimum: 1 }),
  text: Type.String({ minLength: 1 }),
});

export const AskActionSchema = Type.Object({
  type: Type.Literal('ask'),
  step_id: Type.Integer({ minimum: 1 }),
  card_id: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  hint: Type.Optional(Type.String({ minLength: 1 })),
  mode: Type.Union([Type.Literal('open'), Type.Literal('choice')]),
});

export const KeypointCompleteActionSchema = Type.Object({
  type: Type.Literal('keypoint_complete'),
  step_id: Type.Integer({ minimum: 1 }),
  keypoint_id: Type.String({ minLength: 1 }),
  summary: Type.Optional(Type.String({ minLength: 1 })),
});

export const ActionSchema = Type.Union([
  BoardActionSchema,
  NewColumnActionSchema,
  NewPageActionSchema,
  HighlightActionSchema,
  GraphActionSchema,
  SpeakActionSchema,
  AskActionSchema,
  KeypointCompleteActionSchema,
]);
export type Action = Static<typeof ActionSchema>;
export type ActionKind = Action['type'];

export const ActionBatchSchema = Type.Array(ActionSchema, { minItems: 1 });
export type ActionBatch = Static<typeof ActionBatchSchema>;

export const KeypointSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  objective: Type.String({ minLength: 1 }),
  depth: DepthTagSchema,
  status: Type.Union([Type.Literal('pending'), Type.Literal('active'), Type.Literal('completed')]),
});
export type Keypoint = Static<typeof KeypointSchema>;

export const LessonRefSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  depth: DepthTagSchema,
  status: Type.Union([Type.Literal('ready'), Type.Literal('locked'), Type.Literal('completed')]),
  estimatedMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type LessonRef = Static<typeof LessonRefSchema>;

export const UnitSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  lessons: Type.Array(LessonRefSchema, { minItems: 1 }),
});
export type Unit = Static<typeof UnitSchema>;

export const CourseBlueprintSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  topic: Type.String({ minLength: 1 }),
  units: Type.Array(UnitSchema, { minItems: 1 }),
});
export type CourseBlueprint = Static<typeof CourseBlueprintSchema>;

export function validateActions(
  input: unknown,
): { ok: true; actions: ActionBatch } | { ok: false; errors: string[] } {
  if (Value.Check(ActionBatchSchema, input)) {
    const actionErrors = input.flatMap((action, index) => {
      if (
        (action.type === 'board' || action.type === 'graph' || action.type === 'new_column') &&
        action.column > 3
      ) {
        return [`/${index}/column: authored board pages support at most three columns`];
      }
      if (action.type === 'graph' && !sanitizeSvg(action.svg_markup)) {
        return [`/${index}/svg_markup: must be a safe static SVG document`];
      }
      return [];
    });
    return actionErrors.length === 0
      ? { ok: true, actions: input }
      : { ok: false, errors: actionErrors };
  }
  const errors = [...Value.Errors(ActionBatchSchema, input)].map(
    (err) => `${err.path || '/'}: ${err.message}`,
  );
  return { ok: false, errors };
}

export function validateBlueprint(
  input: unknown,
): { ok: true; blueprint: CourseBlueprint } | { ok: false; errors: string[] } {
  if (Value.Check(CourseBlueprintSchema, input)) {
    return { ok: true, blueprint: input };
  }
  const errors = [...Value.Errors(CourseBlueprintSchema, input)].map(
    (err) => `${err.path || '/'}: ${err.message}`,
  );
  return { ok: false, errors };
}
