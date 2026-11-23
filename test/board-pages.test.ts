import assert from 'node:assert/strict';
import test from 'node:test';
import { demoCourses, offlineLesson } from '@eduharness-studio/engine';
import { findBoardPage, projectBoard } from '../apps/web/src/lesson-playback.js';

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

test('historic columns are read as three scrollable columns without losing their card ids', () => {
  const pages = projectBoard([
    { type: 'board', step_id: 1, column: 4, card_id: 'historic-4', content: '旧快照第4栏' },
    { type: 'new_column', step_id: 2, column: 5 },
    { type: 'new_page', step_id: 3, page_id: 'later' },
    {
      type: 'graph',
      step_id: 4,
      column: 5,
      card_id: 'historic-5',
      title: '旧第5栏',
      svg_markup: '<svg/>',
    },
  ]);
  assert.deepEqual(
    pages.map(({ columns }) => columns),
    [3, 3],
  );
  assert.deepEqual(
    pages[0].cards.map(({ action }) => action.column),
    [3],
  );
  assert.equal(pages[0].cards[0].action.card_id, 'historic-4');
  assert.deepEqual(
    pages[1].cards.map(({ action }) => action.card_id),
    ['historic-5'],
  );
  assert.deepEqual(findBoardPage(pages, { card_id: 'historic-5' }), 1);
});
