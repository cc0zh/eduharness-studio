import assert from 'node:assert/strict';
import test from 'node:test';
import {
  demoCourses,
  type LessonRecord,
  offlineLesson,
  projectPlayedDialogue,
} from '@eduharness-studio/engine';
import { locateEvidence } from '../apps/web/src/lesson-evidence.js';
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

test('a specific subtitle anchors its own page even when its teacher turn continues across pages', () => {
  const actions = offlineLesson(demoCourses[0], demoCourses[0].units[0].lessons[0]).actions.slice(
    0,
    22,
  );
  const records: LessonRecord[] = [8, 16].map((ask_step_id) => ({
    kind: 'answer',
    generation: 1,
    ask_step_id,
    text: '学生作答',
  }));
  const dialogue = projectPlayedDialogue(actions, records);
  const pages = projectBoard(actions);
  assert.deepEqual(dialogue.turns[4].evidenceStepIds, [17, 18, 19, 20, 21, 22]);
  const opening = locateEvidence(dialogue, 5, actions, pages, 17);
  assert.equal(opening?.pageIndex, 0);
  assert.equal(opening?.firstCard, 'bayes-rule');
  assert.equal(opening?.caption?.step_id, 17);
  const next = locateEvidence(dialogue, 5, actions, pages, 21);
  assert.equal(next?.pageIndex, 1);
  assert.equal(next?.firstCard, 'changed-base-rate');
  assert.equal(next?.caption?.step_id, 21);
});
