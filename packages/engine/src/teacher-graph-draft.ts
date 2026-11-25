import type { Action } from './protocol.js';
import type { TeacherTurnOutput } from './teacher-protocol.js';

export type TeacherGraphDraft = Extract<TeacherTurnOutput['actions'][number], { type: 'graph' }>;

export function graphFallbackBoard(draft: TeacherGraphDraft, step_id: number): Action {
  const { type, diagram_kind, description, ...board } = draft;
  return { ...board, type: 'board', step_id };
}
