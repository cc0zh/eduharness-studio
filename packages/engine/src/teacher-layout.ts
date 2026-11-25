import { projectKeypointProgress, validateLessonScript } from './lesson-playback.js';
import type { Action, Keypoint } from './protocol.js';
import { stateAfterBeat, type TeachingState } from './state.js';
import type { TeacherProgress, TeacherTurnContext } from './teacher-guardrails.js';
import type { TeacherTurnTrace } from './teacher-protocol.js';

export interface BoardLayoutSummary {
  pageId: string;
  cardsOnPage: number;
  col1Count: number;
  col2Count: number;
  col3Count: number;
}

export function summarizeBoardLayout(actions: readonly Action[]): BoardLayoutSummary {
  let pageId = 'opening';
  let col1Count = 0;
  let col2Count = 0;
  let col3Count = 0;
  for (const action of actions) {
    if (action.type === 'new_page') {
      pageId = action.page_id;
      col1Count = 0;
      col2Count = 0;
      col3Count = 0;
    } else if (action.type === 'board' || action.type === 'graph') {
      if (action.column === 1) col1Count++;
      else if (action.column === 2) col2Count++;
      else col3Count++;
    }
  }
  return {
    pageId,
    cardsOnPage: col1Count + col2Count + col3Count,
    col1Count,
    col2Count,
    col3Count,
  };
}

function uniquePageId(used: Set<string>, seed: string): string {
  let id = seed;
  let suffix = 1;
  while (used.has(id)) id = `${seed}-${++suffix}`;
  used.add(id);
  return id;
}

function nextKeypointTitle(keypoints: readonly Keypoint[], resolvedId: string): string {
  const index = keypoints.findIndex(({ id }) => id === resolvedId);
  return (index >= 0 ? keypoints[index + 1]?.title : undefined) ?? '下一步';
}

export function normalizeTurnLayout(
  context: TeacherTurnContext,
  initialState: TeachingState,
  keypoints: readonly Keypoint[],
  actions: readonly Action[],
  trace: Pick<TeacherTurnTrace, 'diagnosis' | 'inserted' | 'unverified' | 'unverifiedStepId'>,
  progress: TeacherProgress,
): {
  actions: Action[];
  trace: Pick<TeacherTurnTrace, 'diagnosis' | 'inserted' | 'unverified' | 'unverifiedStepId'>;
  progress: TeacherProgress;
} {
  const baseStep = Math.max(context.progress.highWater, context.played.at(-1)?.step_id ?? 0);
  const usedPages = new Set(['opening']);
  for (const action of [...context.played, ...actions]) {
    if (action.type === 'new_page') usedPages.add(action.page_id);
  }
  const initialLayout = summarizeBoardLayout(context.played);
  const staged: Action[] = [...actions];

  const outcomeIdx = staged.findIndex(
    (action) => action.type === 'keypoint_complete' || action.type === 'keypoint_unverified',
  );
  if (outcomeIdx >= 0) {
    const outcome = staged[outcomeIdx];
    const postOutcome = staged.slice(outcomeIdx + 1);
    const firstBoardOffset = postOutcome.findIndex(
      (action) => action.type === 'board' || action.type === 'graph',
    );
    const hasPageBeforeBoard =
      firstBoardOffset >= 0 &&
      postOutcome.slice(0, firstBoardOffset).some((action) => action.type === 'new_page');
    if (
      firstBoardOffset >= 0 &&
      !hasPageBeforeBoard &&
      (outcome.type === 'keypoint_complete' || outcome.type === 'keypoint_unverified')
    ) {
      staged.splice(outcomeIdx + 1, 0, {
        type: 'new_page',
        step_id: 0,
        page_id: uniquePageId(usedPages, `s${baseStep + 1}-kp`),
        title: nextKeypointTitle(keypoints, outcome.keypoint_id),
      });
    }
  } else if (
    initialState === 'diagnose' &&
    context.input.kind !== 'opening' &&
    initialLayout.cardsOnPage >= 4
  ) {
    const firstBoard = staged.findIndex(
      (action) => action.type === 'board' || action.type === 'graph',
    );
    const hasPageBeforeBoard =
      firstBoard >= 0 && staged.slice(0, firstBoard).some((action) => action.type === 'new_page');
    if (firstBoard >= 0 && !hasPageBeforeBoard) {
      const { keypoints: projected, currentIndex } = projectKeypointProgress(
        keypoints,
        context.played,
      );
      staged.splice(firstBoard, 0, {
        type: 'new_page',
        step_id: 0,
        page_id: uniquePageId(usedPages, `s${baseStep + 1}-cont`),
        title: projected[currentIndex]?.title ?? '继续推导',
      });
    }
  }

  let col1 = initialLayout.col1Count;
  let col2 = initialLayout.col2Count;
  let col3 = initialLayout.col3Count;
  const normalized: Action[] = staged.map((action, index) => {
    const step_id = baseStep + index + 1;
    if (action.type === 'new_page') {
      col1 = 0;
      col2 = 0;
      col3 = 0;
      return { ...action, step_id };
    }
    if (action.type === 'board' || action.type === 'graph') {
      let column = action.column;
      if (col1 === 0 && col2 === 0 && col3 === 0 && column !== 1) {
        column = 1;
      } else if (column === 1 && col1 >= 2 && col2 === 0) {
        column = 2;
      } else if (column === 1 && col2 > 0 && col1 >= col2) {
        column = 2;
      }
      if (column === 1) col1++;
      else if (column === 2) col2++;
      else col3++;
      return { ...action, column, step_id };
    }
    return { ...action, step_id };
  });

  let state: TeachingState = initialState;
  for (const [index, action] of normalized.entries()) {
    const next = stateAfterBeat(state, action, false, index === normalized.length - 1);
    if (!next) return { actions: [...actions], trace, progress };
    state = next;
  }
  if (
    !validateLessonScript({
      keypoints: [...keypoints],
      actions: [...context.played, ...normalized],
    })
  ) {
    return { actions: [...actions], trace, progress };
  }
  const unverifiedStepId = trace.unverified
    ? normalized.find(
        (action) =>
          action.type === 'keypoint_unverified' && action.keypoint_id === trace.unverified,
      )?.step_id
    : trace.unverifiedStepId;
  return {
    actions: normalized,
    trace: { ...trace, ...(unverifiedStepId !== undefined ? { unverifiedStepId } : {}) },
    progress: { ...progress, highWater: baseStep + normalized.length },
  };
}
