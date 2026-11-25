import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stateAfterScriptBeat } from '../src/lesson-playback.js';
import type { Action } from '../src/protocol.js';
import { truncateOnInterrupt } from '../src/state.js';
import { compileTeacherTurn, type TeacherTurnContext } from '../src/teacher.js';
import {
  answeredContext,
  masteredScene,
  openingContext,
  scene,
  verifiedContext,
} from './teacher-scene-fixture.js';

function reject(context: TeacherTurnContext, input: unknown, reason?: RegExp) {
  const result = compileTeacherTurn(context, input);
  assert.equal(result.ok, false);
  if (!result.ok && reason) assert.match(result.reasons.join('\n'), reason);
}

test('the compiler expands each panel with exact marks and its own voiceover, and pages only left to right', () => {
  const context = {
    ...openingContext,
    progress: {
      ...openingContext.progress,
      highWater: 19,
      truncatedCardIds: ['s20-panel', 's25-page'],
    },
  };
  const input = scene();
  input.panels.push(
    {
      title: '另外一堆',
      content: '有两对 No.',
      highlight: 'no.',
      voiceover: '现在看另一堆。',
      formula: '2+2',
    },
    { title: '还剩下什么', content: '再数一遍剩下的。', highlight: '剩下' },
  );
  const result = compileTeacherTurn(context, input);
  assert.ok(result.ok);
  assert.deepEqual(result, compileTeacherTurn(context, input));
  assert.deepEqual(
    result.actions.map(({ type }) => type),
    ['board', 'highlight', 'speak', 'board', 'speak', 'new_page', 'board', 'highlight', 'ask'],
  );
  const boards = result.actions.filter((beat) => beat.type === 'board');
  const marks = result.actions.filter((beat) => beat.type === 'highlight');
  assert.deepEqual(
    boards.map(({ column }) => column),
    [1, 2, 1],
  );
  assert.deepEqual(
    marks.map(({ card_id, target_text }) => [card_id, target_text]),
    [
      [boards[0].card_id, '两两'],
      [boards[2].card_id, '剩下'],
    ],
  );
  assert.equal(boards[1].formula, '2+2');
  assert.match(boards[0].card_id, /^s20-panel-/);
  assert.equal(result.actions[5].type === 'new_page' && result.actions[5].page_id, 's25-page-2');
  assert.deepEqual(
    result.actions.map(({ step_id }) => step_id),
    [20, 21, 22, 23, 24, 25, 26, 27, 28],
  );
  assert.equal(result.progress.highWater, 28);
  const orders = new Set<string>();
  for (let i = 0; i < 16; i++) {
    const shuffled = compileTeacherTurn({ ...context, seed: `learner-${i}` }, input);
    assert.ok(shuffled.ok);
    const ask = shuffled.actions.at(-1);
    assert.ok(ask?.type === 'ask' && ask.mode === 'choice');
    assert.deepEqual(
      ask.options?.map(({ label }) => label).sort(),
      [...(input.next_ask?.options ?? [])].sort(),
    );
    orders.add(JSON.stringify(ask.options));
  }
  assert.equal(orders.size, 2);
});

test('continuing after the right column uses a new page and never reuses retired identifiers', () => {
  const context: TeacherTurnContext = {
    ...answeredContext,
    played: [
      {
        type: 'board',
        title: '旧板书',
        content: '已经展示',
        step_id: 9,
        card_id: 'legacy',
        column: 2,
      },
      ...answeredContext.played,
    ],
    progress: {
      ...answeredContext.progress,
      highWater: 19,
      truncatedCardIds: ['s20-page', 's21-panel', 's22-ask'],
    },
  };
  const result = compileTeacherTurn(context, {
    ...scene('clarifying'),
    panels: [{ title: '接下来', content: '再比较' }],
  });
  assert.ok(result.ok);
  assert.deepEqual(
    result.actions.map((beat) =>
      beat.type === 'new_page' ? beat.page_id : 'card_id' in beat && beat.card_id,
    ),
    ['s20-page-2', 's21-panel-2', 's22-ask-2'],
  );
  assert.equal(result.actions[1].type === 'board' && result.actions[1].column, 1);
});

test('when paused between verification and completion, only the played outcome can move the active point', () => {
  const passing = compileTeacherTurn(verifiedContext, masteredScene);
  assert.ok(passing.ok);
  for (const [last, expectedPoint, paged] of [
    [11, 'pairs', false],
    [12, 'sum', true],
  ] as const) {
    const { played } = truncateOnInterrupt([...verifiedContext.played, ...passing.actions], last);
    const context: TeacherTurnContext = {
      ...verifiedContext,
      played,
      progress: passing.progress,
      input: { kind: 'interrupt', text: '先解释刚才说的。' },
    };
    const result = compileTeacherTurn(context, scene('clarifying'));
    assert.ok(result.ok);
    assert.equal(result.keypoints.find(({ status }) => status === 'active')?.id, expectedPoint);
    assert.equal(result.actions[0].type, paged ? 'new_page' : 'board');
    assert.ok(result.actions[0].step_id > passing.progress.highWater);
    assert.equal(
      result.actions.some(({ type }) => type === 'keypoint_complete'),
      false,
    );
  }
});

test('the final resolution still leads its recap; the final content beat needs acknowledged point outcomes', () => {
  const earlierPass: Action = {
    type: 'keypoint_complete',
    step_id: 8,
    keypoint_id: 'pairs',
    summary: '先前结论。',
  };
  const context = { ...verifiedContext, played: [earlierPass, ...verifiedContext.played] };
  const { next_ask, ...finalScene } = masteredScene;
  const result = compileTeacherTurn(context, finalScene);
  assert.ok(result.ok);
  assert.deepEqual(
    result.actions.map(({ type }) => type),
    ['speak', 'keypoint_complete', 'new_page', 'board', 'highlight', 'speak'],
  );
  assert.equal(
    result.actions[1].type === 'keypoint_complete' && result.actions[1].keypoint_id,
    'sum',
  );
  const final = result.actions.at(-1);
  assert.ok(final);
  assert.equal(
    stateAfterScriptBeat('scaffold', final, false, {
      keypoints: result.keypoints,
      actions: [...context.played, ...result.actions],
    }),
    'completed',
  );
  assert.equal(
    stateAfterScriptBeat('scaffold', final, false, {
      keypoints: result.keypoints,
      actions: [...context.played, final],
    }),
    undefined,
  );
  assert.equal(
    stateAfterScriptBeat('scaffold', final, true, {
      keypoints: result.keypoints,
      actions: [...context.played, ...result.actions],
    }),
    undefined,
  );
  reject(context, { ...finalScene, next_ask }, /close the lesson/);
  reject(context, { ...scene('misconception'), next_ask: undefined }, /hand off/);
});
