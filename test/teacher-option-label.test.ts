import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, startAtAsk } from './teacher-test-support.js';

test('teacher receives the selected ask label as learner input, never its semantic option ID', async (t) => {
  const fixture = makeFixture(t);
  const label = '分母只包含已经报警的样本';
  fixture.faux.setResponses([
    fixture.structured({
      diagnosis: { status: 'opening', summary: '先辨认条件。', strategy: '从样本集合开始。' },
      actions: [
        { type: 'board', column: 1, card_id: 'sample-space', content: '条件决定先筛选哪一组。' },
        { type: 'speak', text: '先辨认题目已经告诉我们的条件。' },
        { type: 'highlight', card_id: 'sample-space', target_text: '条件', style: 'circle' },
        {
          type: 'ask',
          card_id: 'sample-space-ask',
          mode: 'choice',
          prompt: '报警后的概率以哪一组为分母？',
          options: [
            { id: 'low', label },
            { id: 'high', label: '所有带标签的样本' },
          ],
        },
      ],
    }),
  ]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));

  let learnerContext = '';
  fixture.faux.setResponses([
    async (context) => {
      learnerContext = context.messages
        .flatMap(({ content }) => (typeof content === 'string' ? [content] : []))
        .join('\n');
      return fixture.structured({
        diagnosis: {
          status: 'clarifying',
          summary: '已选中报警样本作分母。',
          strategy: '继续核对。',
        },
        actions: [
          { type: 'board', column: 1, card_id: 'selected-label', content: label },
          { type: 'speak', text: '你指出了报警样本这一组。' },
          {
            type: 'highlight',
            card_id: 'selected-label',
            target_text: '报警样本',
            style: 'circle',
          },
          { type: 'ask', card_id: 'selected-label-ask', mode: 'open', prompt: '分子是哪一部分？' },
        ],
      });
    },
  ]);
  const answer = await fixture.store.answer(live.id, {
    generation: live.generation,
    ask_step_id: live.ask.step_id,
    option_id: 'low',
  });

  assert.ok('ok' in answer);
  assert.match(learnerContext, new RegExp(label));
  assert.doesNotMatch(learnerContext, /"option_id"\s*:\s*"low"/);
  assert.doesNotMatch(learnerContext, /"id"\s*:\s*"(?:low|high)"/);
  assert.match(learnerContext, /"choice"\s*:\s*true/);
});
