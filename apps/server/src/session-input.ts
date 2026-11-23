import { Type } from '@sinclair/typebox';

const positiveId = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const text = Type.String({ pattern: '\\S', maxLength: 1000 });
const generation = positiveId;
const last_played_step_id = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const strict = { additionalProperties: false };

export const StartSchema = Type.Object({ restart: Type.Optional(Type.Boolean()) }, strict);
export const EmptyBody = Type.Object({}, strict);
export const ProgressSchema = Type.Object({ generation, last_played_step_id: positiveId }, strict);
export const ResumeSchema = Type.Union([
  EmptyBody,
  Type.Object({ generation, last_played_step_id: positiveId }, strict),
]);
export const AnswerSchema = Type.Object({ generation, ask_step_id: positiveId, text }, strict);
export const InterruptSchema = Type.Object({ generation, last_played_step_id, text }, strict);
