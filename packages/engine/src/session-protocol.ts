import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { ActionSchema } from './protocol.js';

export type InterruptIntent = 'explain' | 'answer-request' | 'continue';

export type LessonRecord =
  | { kind: 'subtitle'; generation: number; step_id: number; text: string }
  | { kind: 'answer'; generation: number; ask_step_id: number; text: string }
  | {
      kind: 'interrupt';
      generation: number;
      previous_generation: number;
      last_played_step_id: number;
      truncated_step_ids: number[];
      intent: InterruptIntent;
      text: string;
    };

const positiveId = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const cursor = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const stateSchema = Type.Union([
  Type.Literal('intake'),
  Type.Literal('diagnose'),
  Type.Literal('scaffold'),
  Type.Literal('handoff'),
  Type.Literal('verify'),
  Type.Literal('completed'),
]);
const intentSchema = Type.Union([
  Type.Literal('explain'),
  Type.Literal('answer-request'),
  Type.Literal('continue'),
]);
export const LessonRecordSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('subtitle'),
      generation: positiveId,
      step_id: positiveId,
      text: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('answer'),
      generation: positiveId,
      ask_step_id: positiveId,
      text: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('interrupt'),
      generation: positiveId,
      previous_generation: positiveId,
      last_played_step_id: cursor,
      truncated_step_ids: Type.Array(positiveId),
      intent: intentSchema,
      text: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);
export const SessionSnapshotSchema = Type.Object(
  {
    session_id: Type.String({ minLength: 1 }),
    generation: positiveId,
    last_played_step_id: cursor,
    playedActions: Type.Array(ActionSchema),
    records: Type.Array(LessonRecordSchema),
    state: stateSchema,
    askStep: Type.Union([positiveId, Type.Null()]),
  },
  { additionalProperties: false },
);
export const LessonEndSchema = Type.Object(
  {
    generation: positiveId,
    snapshot: SessionSnapshotSchema,
  },
  { additionalProperties: false },
);

export type SessionSnapshot = Static<typeof SessionSnapshotSchema>;
export type LessonEnd = Static<typeof LessonEndSchema>;

export function readLessonEnd(input: unknown): LessonEnd | undefined {
  return Value.Check(LessonEndSchema, input) ? input : undefined;
}

export interface PlaybackWriteReceipt {
  ok: true;
  record?: LessonRecord;
}

export type PlaybackProgressResult =
  | PlaybackWriteReceipt
  | {
      error: 'session_not_found' | 'stale_generation' | 'unexpected_step';
    };
