import type { Action, LessonRecord } from '@eduharness-studio/engine';

export function recordKey(record: LessonRecord) {
  switch (record.kind) {
    case 'subtitle':
      return `subtitle-${record.step_id}`;
    case 'answer':
      return `answer-${record.ask_step_id}`;
    case 'interrupt':
      return `interrupt-${record.generation}`;
  }
}

export function shouldFollowLatestPage(
  pinned: { id: string; step: number } | null,
  playedStep: number,
): boolean {
  return pinned === null || pinned.step < playedStep;
}

export type BoardCardAction = Extract<Action, { type: 'board' | 'graph' }>;
export interface BoardMark {
  step_id: number;
  target: string;
  style: 'highlight' | 'circle';
}
export interface BoardCard {
  action: BoardCardAction;
  marks: BoardMark[];
}
export interface BoardPage {
  id: string;
  title: string;
  cards: BoardCard[];
  columns: number;
  stepIds: number[];
  cardIds: string[];
}

function blankPage(id: string, title: string): BoardPage {
  return { id, title, cards: [], columns: 1, stepIds: [], cardIds: [] };
}

export function projectBoard(actions: readonly Action[]): BoardPage[] {
  let page = blankPage('opening', '白板课堂');
  const pages = [page];
  for (const action of actions) {
    if (action.type === 'board' || action.type === 'graph' || action.type === 'ask') {
      page.cardIds.push(action.card_id);
    }
    if (action.type === 'new_page') {
      page = blankPage(action.page_id, action.title ?? '新的一页');
      pages.push(page);
    } else if (action.type === 'new_column') {
      page.columns = Math.max(page.columns, action.column);
    } else if (action.type === 'board' || action.type === 'graph') {
      page.columns = Math.max(page.columns, action.column);
      page.cards.push({ action, marks: [] });
    } else if (action.type === 'highlight') {
      const card = pages
        .flatMap(({ cards }) => cards)
        .find(({ action: cardAction }) => cardAction.card_id === action.card_id);
      if (card)
        card.marks.push({
          step_id: action.step_id,
          target: action.target_text,
          style: action.style,
        });
    }
    page.stepIds.push(action.step_id);
  }
  return pages;
}

// Returns a zero-based page index. Step anchors cover every beat; card anchors also include ask cards.
export function findBoardPage(
  pages: readonly BoardPage[],
  anchor: { step_id: number } | { card_id: string },
): number | undefined {
  const index = pages.findIndex((page) =>
    'step_id' in anchor
      ? page.stepIds.includes(anchor.step_id)
      : page.cardIds.includes(anchor.card_id),
  );
  return index < 0 ? undefined : index;
}

export function latestCaption(actions: readonly Action[]) {
  for (let index = actions.length - 1; index >= 0; index--) {
    const action = actions[index];
    if (action.type === 'speak') return action;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// 按上一拍已在屏幕上的内容量计算舒适阅读停顿时长（毫秒）
export function beatAutoplayDelayMs(previous?: Action): number {
  if (!previous) return 120;
  switch (previous.type) {
    case 'new_column':
    case 'new_page':
      return 320;
    case 'ask':
      return 240;
    case 'keypoint_complete':
      return 1100;
    case 'highlight':
      return 1300;
    case 'graph':
      return 2800;
    case 'board': {
      const length = (previous.title?.length ?? 0) + previous.content.length;
      const formulaBonus = previous.formula ? 650 : 0;
      return clamp(1600 + length * 30 + formulaBonus, 2400, 4200);
    }
    case 'speak':
      return clamp(1500 + previous.text.length * 65, 2200, 4500);
  }
}
