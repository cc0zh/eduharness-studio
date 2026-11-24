import type { Action, PlayedDialogue, PublicDialogueTurn } from '@eduharness-studio/engine';
import { type BoardPage, findBoardPage } from './lesson-playback';

type Caption = Extract<Action, { type: 'speak' }>;

export interface EvidenceTarget {
  number: number;
  pageIndex: number;
  cardIds: string[];
  firstCard?: string;
  caption?: Caption;
  recordIndices: number[];
}

export interface EvidenceView {
  numbersByStep: ReadonlyMap<number, number>;
  target?: EvidenceTarget;
  select: (n: number, preferredStep?: number) => void;
}

export function teacherNumbers(turns: readonly PublicDialogueTurn[]) {
  const numbers = new Map<number, number>();
  for (const turn of turns) {
    if (turn.role === 'teacher')
      for (const id of turn.evidenceStepIds) numbers.set(id, turn.turnNumber);
  }
  return numbers;
}

export function locateEvidence(
  dialogue: PlayedDialogue,
  number: number,
  played: readonly Action[],
  pages: readonly BoardPage[],
  preferredStep?: number,
): EvidenceTarget | undefined {
  const turn = dialogue.turns[number - 1];
  if (!turn) return undefined;
  const evidence = new Set(turn.evidenceStepIds);
  const steps = played.filter(({ step_id }) => evidence.has(step_id));
  const cardAnchors = steps.flatMap((action) => {
    if (action.type !== 'board' && action.type !== 'graph' && action.type !== 'highlight')
      return [];
    const pageIndex = findBoardPage(pages, { card_id: action.card_id });
    return pageIndex === undefined ? [] : [{ id: action.card_id, step: action.step_id, pageIndex }];
  });
  const preferred =
    preferredStep !== undefined && evidence.has(preferredStep) ? preferredStep : undefined;
  const firstStep = steps[0]?.step_id;
  const exactCard = cardAnchors.find(({ step }) => step === preferred);
  const preferredPage =
    preferred === undefined ? undefined : findBoardPage(pages, { step_id: preferred });
  const pageIndex =
    exactCard?.pageIndex ??
    preferredPage ??
    cardAnchors[0]?.pageIndex ??
    (firstStep ? findBoardPage(pages, { step_id: firstStep }) : undefined) ??
    0;
  const cardIds = [
    ...new Set(cardAnchors.filter((anchor) => anchor.pageIndex === pageIndex).map(({ id }) => id)),
  ];
  const captions = steps.filter((action) => action.type === 'speak');
  const caption =
    captions.find(({ step_id }) => step_id === preferred) ??
    captions.find(({ step_id }) => findBoardPage(pages, { step_id }) === pageIndex) ??
    captions[0] ??
    played.filter((action) => action.type === 'speak' && action.step_id <= (firstStep ?? 0)).at(-1);
  const nearestCard = pages[pageIndex]?.cards
    .filter(({ action }) => action.step_id <= (preferred ?? firstStep ?? 0))
    .at(-1)?.action.card_id;

  return {
    number,
    pageIndex,
    cardIds: cardIds.length ? cardIds : nearestCard ? [nearestCard] : [],
    firstCard: exactCard?.id ?? cardIds[0] ?? nearestCard,
    caption: caption?.type === 'speak' ? caption : undefined,
    recordIndices: dialogue.recordTurnNumbers.flatMap((n, index) => (n === number ? [index] : [])),
  };
}
