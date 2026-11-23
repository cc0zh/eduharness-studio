import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  type Action,
  ActionBatchSchema,
  type ActionKind,
  ActionSchema,
  type Keypoint,
  KeypointSchema,
} from './protocol.js';
import { sanitizeSvg } from './static-svg.js';

export const LessonKeypointsSchema = Type.Array(KeypointSchema, { minItems: 2, maxItems: 6 });
export const LessonScriptSchema = Type.Object({
  keypoints: LessonKeypointsSchema,
  actions: ActionBatchSchema,
});
export type LessonScript = Static<typeof LessonScriptSchema>;
export type LessonMetadata = Pick<LessonScript, 'keypoints'>;

export function validateLessonScript(input: unknown): input is LessonScript {
  if (!Value.Check(LessonScriptSchema, input)) return false;
  return input.actions.every(
    (action) => action.type !== 'graph' || sanitizeSvg(action.svg_markup) !== undefined,
  );
}

const positiveId = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
export const LessonStreamSchema = Type.Object({ generation: positiveId });
export const LessonBeatSchema = Type.Object({
  ...LessonStreamSchema.properties,
  seq: positiveId,
  action: ActionSchema,
});
export type LessonBeat = Static<typeof LessonBeatSchema>;

export function readLessonBeat(input: unknown): LessonBeat | undefined {
  return Value.Check(LessonBeatSchema, input) ? input : undefined;
}

export function readCurrentLessonBeat(
  input: unknown,
  generation: number,
  lastSequence: number,
): LessonBeat | undefined {
  const beat = readLessonBeat(input);
  return beat && beat.generation === generation && beat.seq > lastSequence ? beat : undefined;
}

export function readLessonGeneration(input: unknown): number | undefined {
  return Value.Check(LessonStreamSchema, input) ? input.generation : undefined;
}

type ActionDraft = {
  [Kind in ActionKind]: Omit<Extract<Action, { type: Kind }>, 'step_id'>;
}[ActionKind];

export type ScriptSection = Omit<Keypoint, 'status'> & { beats: readonly ActionDraft[] };

export function compileLesson(sections: readonly ScriptSection[]): LessonScript {
  const keypoints: Keypoint[] = [];
  const actions: Action[] = [];
  for (const { beats, ...keypoint } of sections) {
    keypoints.push({ ...keypoint, status: keypoints.length === 0 ? 'active' : 'pending' });
    for (const beat of beats) actions.push({ ...beat, step_id: actions.length + 1 });
    actions.push({
      type: 'keypoint_complete',
      step_id: actions.length + 1,
      keypoint_id: keypoint.id,
      summary: keypoint.objective,
    });
  }
  const script = { keypoints, actions };
  if (!validateLessonScript(script)) throw new Error('Invalid offline lesson script');
  const overflow = actions.find(
    (action) =>
      (action.type === 'board' || action.type === 'graph' || action.type === 'new_column') &&
      action.column > 3,
  );
  if (overflow) {
    throw new Error(`Offline lesson columns must not exceed 3 (step ${overflow.step_id})`);
  }
  return script;
}

export function projectKeypointProgress(
  keypoints: readonly Keypoint[],
  played: readonly Action[],
): { keypoints: Keypoint[]; currentIndex: number } {
  const completed = new Set(
    played.flatMap((action) => (action.type === 'keypoint_complete' ? [action.keypoint_id] : [])),
  );
  const firstOpen = keypoints.findIndex(({ id }) => !completed.has(id));
  return {
    keypoints: keypoints.map((keypoint, index) => ({
      ...keypoint,
      status: completed.has(keypoint.id) ? 'completed' : index === firstOpen ? 'active' : 'pending',
    })),
    currentIndex: firstOpen < 0 ? keypoints.length - 1 : firstOpen,
  };
}
