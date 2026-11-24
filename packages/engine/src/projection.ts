import type { Action } from './protocol.js';
import type { LessonRecord } from './session-protocol.js';

export type DialogueEvent =
  | { kind: 'teacher_turn'; actions: readonly Action[] }
  | {
      kind: 'learner_turn';
      text: string;
      evidenceStepIds?: readonly number[];
      interrupted?: boolean;
    };

export interface PublicDialogueTurn {
  turnNumber: number;
  role: 'teacher' | 'learner';
  text: string;
  actionKinds: string[];
  evidenceStepIds: number[];
  interrupted?: boolean;
}

export interface PlayedDialogue {
  turns: PublicDialogueTurn[];
  /** Aligned with the ordered lesson records, not with step IDs (two inputs may share a step). */
  recordTurnNumbers: (number | null)[];
}

function summarizeAction(action: Action): string | null {
  switch (action.type) {
    case 'board': {
      const board = action.title
        ? `[板书: ${action.title}] ${action.content}`
        : `[板书] ${action.content}`;
      return action.formula ? `${board}\n公式: ${action.formula}` : board;
    }
    case 'highlight':
      return `[${action.style === 'circle' ? '圈画' : '高亮'}] ${action.target_text}`;
    case 'graph':
      return action.formula
        ? `[图示: ${action.title}] 公式: ${action.formula}`
        : `[图示: ${action.title}]`;
    case 'speak':
      return action.text;
    case 'ask':
      return `[提问] ${action.prompt}`;
    case 'keypoint_complete':
      return action.summary ? `[过关] ${action.summary}` : null;
    case 'new_column':
    case 'new_page':
      return null;
  }
}

export function projectActionsToPublicDialogue(
  events: readonly DialogueEvent[],
): PublicDialogueTurn[] {
  const turns: PublicDialogueTurn[] = [];
  for (const event of events) {
    if (event.kind === 'learner_turn') {
      const text = event.text.trim();
      if (!text) continue;
      turns.push({
        turnNumber: turns.length + 1,
        role: 'learner',
        text,
        actionKinds: [],
        evidenceStepIds: [...(event.evidenceStepIds ?? [])],
        ...(event.interrupted ? { interrupted: true } : {}),
      });
      continue;
    }

    const parts: string[] = [];
    const actionKinds: string[] = [];
    const evidenceStepIds: number[] = [];
    for (const action of event.actions) {
      const summary = summarizeAction(action);
      if (summary) parts.push(summary);
      if (!actionKinds.includes(action.type)) actionKinds.push(action.type);
      evidenceStepIds.push(action.step_id);
    }
    if (parts.length === 0) {
      for (const action of event.actions) {
        if (action.type === 'new_page') parts.push(`[翻页] ${action.title ?? '新的一页'}`);
        if (action.type === 'new_column') parts.push(`[换栏] 第 ${action.column} 栏`);
        if (action.type === 'keypoint_complete') parts.push('[要点过关]');
      }
    }
    if (parts.length === 0) continue;
    turns.push({
      turnNumber: turns.length + 1,
      role: 'teacher',
      text: parts.join('\n'),
      actionKinds,
      evidenceStepIds,
    });
  }
  return turns;
}

/** Project strictly increasing, acknowledged actions and records in their persisted order. */
export function projectPlayedDialogue(
  playedActions: readonly Action[],
  records: readonly LessonRecord[],
): PlayedDialogue {
  const events: DialogueEvent[] = [];
  const playedIds = new Set(playedActions.map(({ step_id }) => step_id));
  let cursor = 0;
  function teacherThrough(step: number) {
    const start = cursor;
    while (cursor < playedActions.length && playedActions[cursor].step_id <= step) cursor++;
    if (cursor > start)
      events.push({ kind: 'teacher_turn', actions: playedActions.slice(start, cursor) });
  }

  const recordTurnNumbers = records.map((record) => {
    if (record.kind === 'subtitle' || !record.text.trim()) return null;
    const anchor = record.kind === 'answer' ? record.ask_step_id : record.last_played_step_id;
    teacherThrough(anchor);
    const previous = events.at(-1);
    const adjacent = previous?.kind === 'learner_turn' ? previous : undefined;
    // Multiple inputs before another teacher beat are one learner turn; keep their original order.
    const learner: DialogueEvent = {
      kind: 'learner_turn',
      text: [adjacent?.text, record.text.trim()].filter(Boolean).join('\n'),
      evidenceStepIds: [
        ...new Set([
          ...(adjacent?.evidenceStepIds ?? []),
          ...(playedIds.has(anchor) ? [anchor] : []),
        ]),
      ],
      interrupted: adjacent?.interrupted || record.kind === 'interrupt',
    };
    if (adjacent) events[events.length - 1] = learner;
    else events.push(learner);
    return events.length;
  });
  teacherThrough(Number.POSITIVE_INFINITY);
  const turns = projectActionsToPublicDialogue(events);
  const teacherByStep = new Map<number, number>();
  for (const turn of turns) {
    if (turn.role !== 'teacher') continue;
    for (const step of turn.evidenceStepIds) teacherByStep.set(step, turn.turnNumber);
  }
  for (const [index, record] of records.entries()) {
    if (record.kind === 'subtitle')
      recordTurnNumbers[index] = teacherByStep.get(record.step_id) ?? null;
  }
  return { turns, recordTurnNumbers };
}
