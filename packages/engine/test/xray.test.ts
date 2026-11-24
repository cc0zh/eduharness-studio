import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Action, type LessonRecord, projectPlayedDialogue } from '../src/index.js';

const opening: Action[] = [
  {
    type: 'board',
    step_id: 1,
    column: 1,
    card_id: 'first',
    title: '辨析误解',
    content: '不同群体。',
  },
  { type: 'speak', step_id: 2, text: '只数留下的区域。' },
  {
    type: 'ask',
    step_id: 3,
    card_id: 'check',
    mode: 'open',
    prompt: '为什么？',
    hint: '先找分母。',
  },
];
const attempt: LessonRecord = {
  kind: 'answer',
  generation: 1,
  ask_step_id: 3,
  text: '我会看面积，因为总量是这些块的和。',
};
const subtitle: LessonRecord = {
  kind: 'subtitle',
  generation: 1,
  step_id: 2,
  text: '只数留下的区域。',
};
const interrupt: LessonRecord = {
  kind: 'interrupt',
  generation: 2,
  previous_generation: 1,
  last_played_step_id: 5,
  truncated_step_ids: [6, 7, 8],
  intent: 'explain',
  text: '这里为什么？',
};
const verify: Action = { type: 'speak', step_id: 4, text: '核对解释。', checkpoint: 'verify' };

test('groups acknowledged actions, including layout beats, around ordered answers and cuts', () => {
  const actions: Action[] = [
    ...opening,
    verify,
    { type: 'new_page', step_id: 5, page_id: 'second' },
    { type: 'board', step_id: 9, column: 1, card_id: 'new', content: '续讲。' },
    { type: 'speak', step_id: 10, text: '换个例子。' },
  ];
  const records = [subtitle, attempt, interrupt];
  const { turns, recordTurnNumbers } = projectPlayedDialogue(actions, records);
  assert.deepEqual(
    turns.map(({ turnNumber, role, evidenceStepIds }) => [turnNumber, role, evidenceStepIds]),
    [
      [1, 'teacher', [1, 2, 3]],
      [2, 'learner', [3]],
      [3, 'teacher', [4, 5]],
      [4, 'learner', [5]],
      [5, 'teacher', [9, 10]],
    ],
  );
  assert.deepEqual(recordTurnNumbers, [1, 2, 4]);
  assert.equal(turns[3].interrupted, true);
  assert.match(turns[0].text, /辨析误解[\s\S]+只数留下[\s\S]+为什么/);
  assert.deepEqual(projectPlayedDialogue([], []), { turns: [], recordTurnNumbers: [] });
});

test('keeps input order at the same cursor, preserves a visible layout-only turn, and never invents step 0', () => {
  const openingCut = { ...interrupt, last_played_step_id: 0 };
  const { turns, recordTurnNumbers } = projectPlayedDialogue(
    [...opening, { type: 'new_page', step_id: 5, page_id: 'second', title: '第二页' }],
    [openingCut, attempt, { ...interrupt, last_played_step_id: 3 }, interrupt],
  );
  assert.deepEqual(
    turns.map((turn) => turn.role),
    ['learner', 'teacher', 'learner', 'teacher', 'learner'],
  );
  assert.deepEqual(turns[0].evidenceStepIds, []);
  assert.equal(turns[2].text, `${attempt.text}\n${interrupt.text}`);
  assert.deepEqual(turns[2].evidenceStepIds, [3]);
  assert.equal(turns[3].text, '[翻页] 第二页');
  assert.deepEqual(recordTurnNumbers, [1, 3, 3, 5]);
});
