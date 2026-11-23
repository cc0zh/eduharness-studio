import type { Action } from './protocol.js';

export type TeachingState = 'intake' | 'diagnose' | 'scaffold' | 'handoff' | 'verify' | 'completed';

const ALLOWED_TRANSITIONS: Record<TeachingState, readonly TeachingState[]> = {
  intake: ['diagnose', 'scaffold'],
  diagnose: ['scaffold', 'handoff'],
  scaffold: ['handoff', 'verify', 'diagnose'],
  handoff: ['verify', 'scaffold', 'diagnose'],
  verify: ['scaffold', 'handoff', 'completed'],
  completed: [],
};

export function canTransition(from: TeachingState, to: TeachingState): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
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
