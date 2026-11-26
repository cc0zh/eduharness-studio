import { containsCredential } from './model-configuration.js';
import type { Action, LessonRef } from './protocol.js';
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
      return `[提问] ${action.prompt}${action.mode === 'choice' && action.options ? `\n选项: ${action.options.map(({ label }) => label).join(' / ')}` : ''}`;
    case 'keypoint_complete':
      return action.summary ? `[过关] ${action.summary}` : null;
    case 'keypoint_unverified':
      return '[要点未验证]';
    case 'new_column':
    case 'new_page':
      return null;
  }
}

export function projectActionsToPublicDialogue(
  events: readonly DialogueEvent[],
  audience: 'public' | 'teacher-context' = 'public',
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
    let hasSummary = false;
    for (const action of event.actions) {
      const summary = summarizeAction(action);
      if (summary) {
        hasSummary = true;
        parts.push(summary);
      } else if (action.type === 'keypoint_complete' && audience === 'public') {
        parts.push('[要点过关]');
      }
      if (!actionKinds.includes(action.type)) actionKinds.push(action.type);
      evidenceStepIds.push(action.step_id);
    }
    if (!hasSummary) {
      parts.length = 0;
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
  audience: 'public' | 'teacher-context' = 'public',
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
  const turns = projectActionsToPublicDialogue(events, audience);
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

/** Wire shape owned by eduharness-ts EvidenceMessageSchema. IDs are local to a transcript. */
export interface EvidenceMessage {
  readonly id: string;
  readonly role: PublicDialogueTurn['role'];
  readonly turn: number;
  readonly text: string;
}

type ProjectionErrorCode =
  | 'cursor_mismatch'
  | 'empty_lesson'
  | 'no_student_interaction'
  | 'insufficient_dialogue'
  | 'invalid_dialogue_order'
  | 'invalid_evidence_text'
  | 'credential_detected';

export class JudgeProjectionError extends Error {
  constructor(readonly code: ProjectionErrorCode) {
    super(code);
    this.name = 'JudgeProjectionError';
  }
}

// Refuse recognizable credentials pasted into public text. Keep the evidence verbatim or reject it.
const credentialText =
  /\b(?:sk-[\w-]{16,}|AIza[\w-]{35})\b|\bBearer[ \t]+[\w.~+/=-]{12,}|\b(?:[a-z0-9]+_)*(?:api[ _-]?key|access[ _-]?token)\b["']?[ \t]*[:=][ \t]*["']?[\w.~+/=-]{8,}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/i;

export function assertJudgeTextSafe(text: string, knownCredentials: readonly string[] = []) {
  if (text.includes('\0') || /[\uD800-\uDFFF]/u.test(text))
    throw new JudgeProjectionError('invalid_evidence_text');
  if (credentialText.test(text) || knownCredentials.some((key) => containsCredential(text, key)))
    throw new JudgeProjectionError('credential_detected');
}

interface JudgeDialogueInput {
  topic: string;
  lesson: Pick<LessonRef, 'title' | 'summary'>;
  basisObjective?: string;
  played: readonly Action[];
  records: readonly LessonRecord[];
  lastPlayedStepId: number;
  knownCredentials?: readonly string[];
}

export function projectEvidenceMessages({
  topic,
  lesson,
  basisObjective,
  played,
  records,
  lastPlayedStepId,
  knownCredentials,
}: JudgeDialogueInput): EvidenceMessage[] {
  const acknowledged = played.filter(({ step_id }) => step_id <= lastPlayedStepId);
  const byStep = new Map<number, Action>();
  let step = 0;
  for (const action of acknowledged) {
    if (!Number.isSafeInteger(action.step_id) || action.step_id <= step)
      throw new JudgeProjectionError('cursor_mismatch');
    step = action.step_id;
    byStep.set(step, action);
  }
  if (step !== lastPlayedStepId) throw new JudgeProjectionError('cursor_mismatch');

  let lastAnchor = 0;
  let hasStudentInput = false;
  for (const record of records) {
    if (record.kind === 'subtitle') continue;
    const anchor = record.kind === 'answer' ? record.ask_step_id : record.last_played_step_id;
    const aligned =
      record.kind === 'answer'
        ? byStep.get(anchor)?.type === 'ask'
        : anchor === 0 || byStep.has(anchor);
    const cutPlayedStep =
      record.kind === 'interrupt' && record.truncated_step_ids.some((id) => byStep.has(id));
    if (!aligned || anchor < lastAnchor || cutPlayedStep)
      throw new JudgeProjectionError('cursor_mismatch');
    lastAnchor = anchor;
    hasStudentInput ||= Boolean(record.text.trim());
  }
  if (acknowledged.length === 0) throw new JudgeProjectionError('empty_lesson');
  if (!hasStudentInput) throw new JudgeProjectionError('no_student_interaction');

  let opening = `课程主题：${topic.trim()}\n课节：${lesson.title.trim()}\n入课目标：${lesson.summary.trim()}`;
  if (basisObjective?.trim()) opening += `\n轻调研目标：${basisObjective.trim()}`;
  const { turns } = projectPlayedDialogue(acknowledged, records);
  const dialogue = turns.map(({ role, text, interrupted }) => ({
    role,
    text: interrupted ? `[含插话]\n${text}` : text,
  }));
  // The server accepts an interruption at cursor 0. Keep that real input distinct
  // from the goal, but in the same learner message until a teacher action plays.
  const first = dialogue[0];
  if (first?.role === 'learner') {
    opening += `\n\n${first.text}`;
    dialogue.shift();
  }
  dialogue.unshift({ role: 'learner', text: opening });
  if (dialogue.length < 3) throw new JudgeProjectionError('insufficient_dialogue');
  return dialogue.map(({ role, text }, index) => {
    if (role !== (index % 2 ? 'teacher' : 'learner') || !text.trim())
      throw new JudgeProjectionError('invalid_dialogue_order');
    assertJudgeTextSafe(text, knownCredentials);
    return {
      id: `m${index + 1}`,
      role,
      turn: Math.ceil(index / 2),
      text,
    };
  });
}
