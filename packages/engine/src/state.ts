import type { Action } from './protocol.js';

export type TeachingState = 'intake' | 'diagnose' | 'scaffold' | 'handoff' | 'verify' | 'completed';

export interface TeachingTransition {
  from: TeachingState | null;
  to: TeachingState;
  generation: number;
  step_id: number;
}

const ALLOWED_TRANSITIONS: Record<TeachingState, readonly TeachingState[]> = {
  intake: ['diagnose'],
  diagnose: ['scaffold'],
  scaffold: ['handoff', 'diagnose'],
  handoff: ['verify', 'diagnose'],
  verify: ['diagnose', 'completed'],
  completed: [],
};

export function canTransition(from: TeachingState, to: TeachingState): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// Evaluate both before dispatch (guard) and on acknowledgement (commit).
export function stateAfterBeat(
  state: TeachingState,
  action: Action,
  waitingForAnswer: boolean,
  final: boolean,
): TeachingState | undefined {
  if (waitingForAnswer || state === 'intake' || state === 'completed') return undefined;
  if (final && action.type !== 'keypoint_complete') return undefined;
  if (action.type === 'keypoint_complete') {
    return state === 'verify' ? (final ? 'completed' : 'diagnose') : undefined;
  }
  if (action.type === 'ask') return state === 'scaffold' ? 'handoff' : undefined;
  if (action.type === 'speak' && action.checkpoint === 'verify') {
    return state === 'handoff' ? 'verify' : undefined;
  }
  if (state === 'verify') return undefined;
  return state === 'diagnose' ? 'scaffold' : state;
}

export interface InterruptResult {
  played: Action[];
  truncated: Action[];
  lastPlayedStepId: number | null;
}

export function truncateOnInterrupt(
  queue: readonly Action[],
  lastPlayedStepId: number | null,
): InterruptResult {
  if (lastPlayedStepId === null) {
    return { played: [], truncated: [...queue], lastPlayedStepId: null };
  }
  const played: Action[] = [];
  const truncated: Action[] = [];
  for (const action of queue) {
    if (action.step_id <= lastPlayedStepId) {
      played.push(action);
    } else {
      truncated.push(action);
    }
  }
  const actualLast = played.length > 0 ? played[played.length - 1].step_id : null;
  return { played, truncated, lastPlayedStepId: actualLast };
}
