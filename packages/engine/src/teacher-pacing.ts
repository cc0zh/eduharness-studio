import type { Action, Keypoint } from './protocol.js';

export const lessonBeatLimit = 70;
export const minTeachingTurnBeats = 3; // A bare panel may still need a page and a question.

// A pending point needs a cue and an honest outcome. The recap needs a page and a board.
const outcomeBeats = 2;
const recapBeats = 2;
const maxSinglePanelTurnBeats = 8; // One page, board, mark, voiceover, question and outcome.
const closeReserve = (openPoints: number) => outcomeBeats * openPoints + recapBeats;
export const isOpenKeypoint = (point: Keypoint) =>
  point.status === 'pending' || point.status === 'active';

export function teacherPacing(playedBeats: number, keypoints: readonly Keypoint[]) {
  const openPoints = keypoints.filter(isOpenKeypoint).length;
  const teachingBeats = lessonBeatLimit - playedBeats - closeReserve(openPoints);
  return {
    playedBeats,
    openPoints,
    teachingBeats,
    tight: teachingBeats <= maxSinglePanelTurnBeats * Math.max(1, openPoints),
    close: teachingBeats < minTeachingTurnBeats,
  };
}

export type TeacherPacing = ReturnType<typeof teacherPacing>;

export function teacherBeatBudgetReason(
  playedBeats: number,
  actions: readonly Action[],
  keypointsBeforeTurn?: readonly Keypoint[],
) {
  if (playedBeats + actions.length > lessonBeatLimit) {
    return keypointsBeforeTurn
      ? `beat budget exceeded: at most ${lessonBeatLimit - playedBeats} new beats; trim panels, highlights or voiceover`
      : `beat budget exhausted: this closure would exceed ${lessonBeatLimit} acknowledged beats`;
  }
  if (!keypointsBeforeTurn) return undefined;

  // A turn can be cut after any acknowledged beat. Only a played outcome releases its reserve.
  const open = new Set(keypointsBeforeTurn.filter(isOpenKeypoint).map(({ id }) => id));
  const available = lessonBeatLimit - playedBeats - closeReserve(open.size);
  let used = 0;
  let peak = 0;
  for (const action of actions) {
    used++;
    if (
      (action.type === 'keypoint_complete' || action.type === 'keypoint_unverified') &&
      open.delete(action.keypoint_id)
    ) {
      used -= outcomeBeats;
    }
    peak = Math.max(peak, used);
  }
  return peak > available
    ? `beat budget exceeded: ${available} beats available before the reserved close; trim panels, highlights or voiceover`
    : undefined;
}
