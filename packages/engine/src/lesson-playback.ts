import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  type Action,
  ActionBatchSchema,
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
  const cards = new Set<string>();
  const boardCards = new Set<string>();
  const pages = new Set(['opening']);
  let lastStep = 0;
  return input.actions.every((action) => {
    if (action.step_id <= lastStep) return false;
    lastStep = action.step_id;
    if (action.type === 'new_page') {
      if (pages.has(action.page_id)) return false;
      pages.add(action.page_id);
    } else if (action.type === 'highlight') {
      return boardCards.has(action.card_id);
    } else if (action.type === 'board' || action.type === 'graph' || action.type === 'ask') {
      if (cards.has(action.card_id)) return false;
      cards.add(action.card_id);
      if (action.type !== 'ask') boardCards.add(action.card_id);
      if (action.type === 'graph' && !sanitizeSvg(action.svg_markup)) return false;
    }
    return true;
  });
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

type Unnumbered<T> = T extends Action ? Omit<T, 'step_id'> : never;
export type ActionDraft = Unnumbered<Action>;

export type ScriptSection = Omit<Keypoint, 'status'> & {
  beats: readonly ActionDraft[];
  verification: string;
};

export function sectionBeats(
  { id, objective, beats, verification }: ScriptSection,
  after: number,
): Action[] {
  const drafts: ActionDraft[] = [
    ...beats,
    { type: 'speak', checkpoint: 'verify', text: verification },
    { type: 'keypoint_complete', keypoint_id: id, summary: objective },
  ];
  return drafts.map((beat, i) => ({ ...beat, step_id: after + i + 1 }));
}

export function compileLesson(sections: readonly ScriptSection[]): LessonScript {
  const keypoints: Keypoint[] = [];
  const actions: Action[] = [];
  for (const section of sections) {
    const { id, title, objective, depth } = section;
    keypoints.push({
      id,
      title,
      objective,
      depth,
      status: keypoints.length ? 'pending' : 'active',
    });
    actions.push(...sectionBeats(section, actions.length));
  }
  const script = { keypoints, actions };
  if (!validateLessonScript(script)) throw new Error('Invalid offline lesson script');
  return script;
}

export function projectKeypointProgress(
  keypoints: readonly Keypoint[],
  played: readonly Action[],
): { keypoints: Keypoint[]; currentIndex: number } {
  const outcomes = new Map<string, 'completed' | 'unverified'>();
  for (const action of played) {
    if (action.type === 'keypoint_complete') outcomes.set(action.keypoint_id, 'completed');
    if (action.type === 'keypoint_unverified') outcomes.set(action.keypoint_id, 'unverified');
  }
  const firstOpen = keypoints.findIndex(({ id }) => !outcomes.has(id));
  return {
    keypoints: keypoints.map((keypoint, index) => ({
      ...keypoint,
      status: outcomes.get(keypoint.id) ?? (index === firstOpen ? 'active' : 'pending'),
    })),
    currentIndex: firstOpen < 0 ? keypoints.length - 1 : firstOpen,
  };
}
