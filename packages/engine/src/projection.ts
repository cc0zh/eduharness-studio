import type { Action } from './protocol.js';

export type DialogueEvent =
  | { kind: 'teacher_turn'; actions: readonly Action[] }
  | { kind: 'learner_turn'; text: string; interrupted?: boolean };

export interface PublicDialogueTurn {
  turnNumber: number;
  role: 'teacher' | 'learner';
  text: string;
  actionKinds: string[];
  evidenceStepIds: number[];
  interrupted?: boolean;
}

function summarizeAction(action: Action): string | null {
  switch (action.type) {
    case 'board':
      return action.title
        ? `[板书: ${action.title}] ${action.content}`
        : `[板书] ${action.content}`;
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
        evidenceStepIds: [],
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
