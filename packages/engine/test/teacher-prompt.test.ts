import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFauxModelGateway, fauxAssistantMessage, fauxToolCall } from '../src/models.js';
import {
  createTeacherPlanner,
  type TeacherTurnContext,
  type TeacherTurnOutput,
} from '../src/teacher.js';

const previousAsk = {
  type: 'ask',
  step_id: 10,
  card_id: 'previous-ask',
  mode: 'open',
  prompt: '先验概率很低时，检测阳性意味着什么？',
} as const;
const context: TeacherTurnContext = {
  topic: '贝叶斯基数率效应',
  keypoints: [
    {
      id: 'posterior',
      title: '阳性预测值',
      objective: '用基数率计算后验概率',
      depth: 'application',
      status: 'active',
    },
    {
      id: 'specificity',
      title: '特异度',
      objective: '准确计算未患病样本的阴性比例',
      depth: 'theory',
      status: 'pending',
    },
  ],
  state: 'handoff',
  played: [previousAsk],
  input: { kind: 'answer', ask_step_id: 10, text: '需要区分患病人数与没有患病的人数。' },
  progress: { highWater: 10, insertedCount: 0, lowEffortStreak: 0, truncatedCardIds: [] },
  generation: 1,
  seed: 'prompt-regression',
};

const finalAnswer: TeacherTurnOutput = {
  diagnosis: {
    status: 'answer_seeking',
    summary: '基数率决定阳性中的真实比例。',
    strategy: '用同一批人数重新列出混淆矩阵。',
  },
  actions: [
    {
      type: 'board',
      column: 1,
      card_id: 's11-b1',
      title: '先数真实患病者',
      content: '10000人中，先按患病率算出患病人数。',
    },
    { type: 'highlight', card_id: 's11-b1', target_text: '患病人数', style: 'highlight' },
    { type: 'speak', text: '检测准确率不能取代人群中的基数率。' },
    {
      type: 'ask',
      card_id: 's11-q1',
      mode: 'open',
      prompt: '把敏感度换成80%，阳性预测值会怎样变化？',
      checkpoint: 'verify',
    },
  ],
};
const intermediateAndFinalAsks: TeacherTurnOutput = {
  diagnosis: {
    status: 'answer_seeking',
    summary: '基数率决定阳性中的真实比例。',
    strategy: '先继续列人数，再检查近迁移。',
  },
  actions: [
    { type: 'speak', text: '先把检测阳性的人分开计数。' },
    { type: 'board', column: 1, card_id: 's11-b1', content: '样本分为患病和未患病两部分。' },
    { type: 'ask', card_id: 's11-q1', mode: 'open', prompt: '应先计算哪一组人数？' },
    { type: 'speak', text: '继续用人数填入混淆矩阵。' },
    {
      type: 'ask',
      card_id: 's11-q2',
      mode: 'open',
      prompt: '如果敏感度改变，阳性预测值会怎样？',
      checkpoint: 'verify',
    },
  ],
};
const emit = (value: TeacherTurnOutput) =>
  fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });

test('faux teacher correction keeps at most one ask, as the final action', async () => {
  const faux = createFauxModelGateway();
  assert.ok(
    faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'prompt-test-key' }),
  );
  let retryPrompt = '';
  faux.setResponses([
    emit(intermediateAndFinalAsks),
    (request) => {
      retryPrompt = request.messages
        .filter(({ role }) => role === 'user')
        .map(({ content }) => String(content))
        .join('\n');
      return emit(finalAnswer);
    },
  ]);

  const result = await createTeacherPlanner(faux.gateway, [])(context, []);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result));
  assert.equal(result.actions.filter(({ type }) => type === 'ask').length, 1);
  assert.equal(result.actions.at(-1)?.type, 'ask');
  assert.equal(result.trace.guardrails.length, 1);
  assert.ok(
    result.trace.guardrails[0].reasons.some((reason) =>
      reason.includes('only the last beat can be ask'),
    ),
  );
  assert.match(retryPrompt, /每轮 actions 至多一个 ask/);
  assert.match(retryPrompt, /数组唯一的最后一拍/);
  assert.match(retryPrompt, /only the last beat can be ask/);
  assert.equal(faux.state.callCount, 2);
});

test('faux interruption instruction requires one ordinary terminal ask', async () => {
  const faux = createFauxModelGateway();
  assert.ok(
    faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'prompt-test-key' }),
  );
  let prompt = '';
  faux.setResponses([
    (request) => {
      prompt = request.messages
        .filter(({ role }) => role === 'user')
        .map(({ content }) => String(content))
        .join('\n');
      return emit({
        diagnosis: {
          status: 'clarifying',
          summary: '先解释眼前的问题。',
          strategy: '沿用已上屏的例子。',
        },
        actions: [
          { type: 'speak', text: '这次从已上屏的基数率继续推理。' },
          {
            type: 'board',
            column: 1,
            card_id: 's11-b1',
            content: '阳性组同时包含真阳性和假阳性。',
          },
          { type: 'speak', text: '两类人都要计入阳性分母。' },
          { type: 'board', column: 1, card_id: 's11-b2', content: '先分别标出真阳性与假阳性。' },
          {
            type: 'ask',
            card_id: 's11-q1',
            mode: 'open',
            prompt: '改变患病率后，阳性组的构成会怎样？',
          },
        ],
      });
    },
  ]);
  const result = await createTeacherPlanner(faux.gateway, [])(
    { ...context, input: { kind: 'interrupt', text: '继续解释阳性组里都有哪些人。' } },
    [],
  );
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result));
  assert.match(prompt, /恰好一个不带 checkpoint 的普通 ask/);
  assert.match(prompt, /数组最后一拍/);
  assert.equal(result.actions.filter(({ type }) => type === 'ask').length, 1);
  assert.equal(result.actions.at(-1)?.type, 'ask');
  assert.equal(faux.state.callCount, 1);
});
