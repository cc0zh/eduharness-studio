import type { Action } from '@eduharness-studio/engine';

export type BoardCardAction = Extract<Action, { type: 'board' | 'graph' }>;
export interface BoardMark {
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
      page.columns = Math.max(page.columns, Math.min(action.column, 3));
    } else if (action.type === 'board' || action.type === 'graph') {
      const column = Math.min(action.column, 3);
      page.columns = Math.max(page.columns, column);
      page.cards.push({ action: { ...action, column }, marks: [] });
    } else if (action.type === 'highlight') {
      const card = pages
        .flatMap(({ cards }) => cards)
        .find(({ action: cardAction }) => cardAction.card_id === action.card_id);
      if (card) card.marks.push({ target: action.target_text, style: action.style });
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
  return actions.reduce(
    (caption, action) => (action.type === 'speak' ? action.text : caption),
    '老师正在整理白板…',
  );
}
