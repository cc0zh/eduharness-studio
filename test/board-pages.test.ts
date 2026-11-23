import assert from 'node:assert/strict';
import test from 'node:test';
import { demoCourses, offlineLesson } from '@eduharness-studio/engine';
import {
  findBoardPage,
  projectBoard,
  shouldFollowLatestPage,
} from '../apps/web/src/lesson-playback.js';

test('projectBoard preserves complete immutable history when a script advances to new pages', () => {
  const script = offlineLesson(demoCourses[0], demoCourses[0].units[0].lessons[0]);
  const pages = projectBoard(script.actions);
  assert.deepEqual(
    pages.map(({ id }) => id),
    ['opening', 'base-rate'],
  );
  assert.deepEqual(
    pages[0].cards.map(({ action }) => action.card_id),
    ['alarm-setup', 'alarm-areas', 'reverse-conditions', 'bayes-rule'],
  );
  assert.equal(pages[1].cards.at(-1)?.action.card_id, 'base-rate-answer');
  assert.equal(
    findBoardPage(pages, {
      step_id: script.actions.find(({ type }) => type === 'new_page')?.step_id ?? 0,
    }),
    1,
  );
  assert.equal(findBoardPage(pages, { card_id: 'bayes-rule' }), 0);
  assert.equal(findBoardPage(pages, { card_id: 'guess-denominator' }), 0);
  const ask = script.actions.find(({ type }) => type === 'ask');
  assert.ok(ask);
  assert.equal(findBoardPage(pages, { step_id: ask.step_id }), 0);
  assert.equal(findBoardPage(pages, { card_id: 'not-on-the-board' }), undefined);
});

test('page indexing follows newest page but an operator-pinned index stays explicit', () => {
  const script = offlineLesson(demoCourses[0], demoCourses[0].units[0].lessons[0]);
  const prefix = script.actions.slice(
    0,
    script.actions.findIndex(({ type }) => type === 'new_page'),
  );
  const oldPage = projectBoard(prefix)[0];
  const withNewPage = projectBoard(script.actions);
  assert.deepEqual(oldPage.cards, withNewPage[0].cards);
  assert.equal(withNewPage.length - 1, 1);
});

test('a pinned historical page stays visible until playback advances, then follows the displayed beat', () => {
  const pin = { id: 'opening', step: 8 };
  assert.equal(shouldFollowLatestPage(null, 8), true);
  assert.equal(shouldFollowLatestPage(pin, 8), false);
  assert.equal(shouldFollowLatestPage(pin, 9), true);
});

test('highlights on a new page still mark cards retained on a historical page', () => {
  const script = offlineLesson(demoCourses[0], demoCourses[0].units[0].lessons[0]);
  const actions = [
    ...script.actions,
    {
      type: 'highlight' as const,
      step_id: script.actions.length + 1,
      card_id: 'alarm-setup',
      target_text: 'heard later',
      style: 'circle' as const,
    },
  ];
  const pages = projectBoard(actions);
  assert.ok(
    pages[0].cards[0].marks.some(
      ({ target, style }) => target === 'heard later' && style === 'circle',
    ),
  );
  assert.equal(findBoardPage(pages, { card_id: 'alarm-setup' }), 0);
});
