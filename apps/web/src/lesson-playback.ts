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
export interface BoardCanvas {
  cards: BoardCard[];
  columns: number;
  pageTitle: string;
}

export function projectBoard(actions: readonly Action[]): BoardCanvas {
  const canvas: BoardCanvas = { cards: [], columns: 1, pageTitle: '白板课堂' };
  for (const action of actions) {
    if (action.type === 'new_page') {
      canvas.cards = [];
      canvas.columns = 1;
      canvas.pageTitle = action.title ?? '新的一页';
    } else if (action.type === 'new_column') {
      canvas.columns = Math.max(canvas.columns, action.column);
    } else if (action.type === 'board' || action.type === 'graph') {
      canvas.columns = Math.max(canvas.columns, action.column);
      canvas.cards.push({ action, marks: [] });
    } else if (action.type === 'highlight') {
      const card = canvas.cards.find(
        ({ action: cardAction }) => cardAction.card_id === action.card_id,
      );
      if (card) card.marks.push({ target: action.target_text, style: action.style });
    }
  }
  return canvas;
}

export function latestCaption(actions: readonly Action[]) {
  return actions.reduce(
    (caption, action) => (action.type === 'speak' ? action.text : caption),
    '老师正在整理白板…',
  );
}
