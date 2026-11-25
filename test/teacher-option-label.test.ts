import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, startAtAsk } from './teacher-test-support.js';

test('teacher receives the selected label, not the generated option ID, after shuffling', async (t) => {
  const fixture = makeFixture(t);
  const label = '分母只包含已经报警的样本';
  const labels = [label, '所有带标签的样本'];
  fixture.faux.setResponses([
    fixture.structured({
      diagnosis: { status: 'opening', summary: '先辨认条件。', strategy: '从样本集合开始。' },
      panels: [
        {
          title: '样本集合',
          content: '条件决定先筛选哪一组。',
          highlight: '条件',
          voiceover: '先辨认题目已经告诉我们的条件。',
        },
      ],
      next_ask: { prompt: '报警后的概率以哪一组为分母？', options: labels },
    }),
  ]);
  const live = await startAtAsk(fixture.store, () => fixture.store.start(fixture.options(false)));
  assert.ok(live.ask.mode === 'choice' && live.ask.options);
  const options = live.ask.options;
  assert.deepEqual(options.map(({ label }) => label).sort(), [...labels].sort());
  const selected = options.find((option) => option.label === label);
  assert.ok(selected);
  assert.deepEqual(options.map(({ id }) => id).sort(), ['option-1', 'option-2']);

  let prompt = '';
  fixture.faux.setResponses([
    ({ messages }) => {
      const user = messages.find(({ role }) => role === 'user');
      assert.equal(typeof user?.content, 'string');
      prompt = String(user?.content);
      return fixture.structured({
        diagnosis: {
          status: 'clarifying',
          summary: '已选中报警样本作分母。',
          strategy: '继续核对。',
        },
        panels: [
          {
            title: '选中的样本范围',
            content: label,
            highlight: '已经报警',
            voiceover: '你指出了报警样本这一组。',
          },
        ],
        next_ask: { prompt: '分子是哪一部分？' },
      });
    },
  ]);
  const answer = await fixture.store.answer(live.id, {
    generation: live.generation,
    ask_step_id: live.ask.step_id,
    option_id: selected.id,
  });

  assert.ok('ok' in answer && answer.record?.kind === 'answer');
  assert.equal(answer.record.text, label);
  const line = prompt.split('\n').find((line) => line.startsWith('课堂输入：'));
  assert.ok(line);
  const context = JSON.parse(line.slice('课堂输入：'.length));
  assert.equal(context.input.kind, 'answer');
  assert.equal(context.input.text, label);
  assert.equal(context.input.choice, true);
  assert.equal('option_id' in context.input, false);
  assert.deepEqual(
    context.currentAsk.options,
    options.map(({ label }) => label),
  );
  for (const { id } of options) assert.equal(prompt.includes(JSON.stringify(id)), false);
  assert.equal(fixture.faux.state.callCount, 2);
});
