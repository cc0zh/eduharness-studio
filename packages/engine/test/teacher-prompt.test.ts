import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { createFauxModelGateway, fauxAssistantMessage, fauxToolCall } from '../src/models.js';
import {
  createTeacherPlanner,
  type TeacherTurnContext,
  type TeacherTurnOutput,
  teacherTurnSchemaForContext,
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
  assert.match(prompt, /若本轮合法满足结课条件/);
  assert.match(prompt, /否则必须以正好 1 个不带 checkpoint 的普通 ask 结尾/);
  assert.match(prompt, /数组最后一拍/);
  assert.equal(result.actions.filter(({ type }) => type === 'ask').length, 1);
  assert.equal(result.actions.at(-1)?.type, 'ask');
  assert.equal(faux.state.callCount, 1);
});

test('turn schemas omit opening, ordinary-answer and interruption fields that the guard forbids', () => {
  const openingContext: TeacherTurnContext = {
    ...context,
    state: 'intake',
    played: [],
    input: { kind: 'opening' },
    progress: { ...context.progress, highWater: 0 },
  };
  const opening: TeacherTurnOutput = {
    diagnosis: { status: 'opening', summary: '先认清样本。', strategy: '按人群列格子。' },
    actions: [
      { type: 'board', column: 1, card_id: 's1-b1', content: '先分患病者和未患病者。' },
      { type: 'speak', text: '再观察哪些人会检测阳性。' },
      { type: 'board', column: 1, card_id: 's1-b2', content: '基数率改变阳性组的人数。' },
      { type: 'ask', card_id: 's1-q1', mode: 'open', prompt: '阳性组包括哪两类人？' },
    ],
  };
  const openingSchema = teacherTurnSchemaForContext(openingContext);
  assert.equal(Value.Check(openingSchema, opening), true);
  assert.equal(
    Value.Check(openingSchema, {
      ...opening,
      diagnosis: { ...opening.diagnosis, status: 'clarifying' },
    }),
    false,
  );
  assert.equal(
    Value.Check(openingSchema, {
      ...opening,
      insert_keypoint: {
        id: 'prerequisite',
        title: '识别阳性',
        objective: '辨认阳性样本。',
        depth: 'intuition',
      },
    }),
    false,
  );
  assert.equal(
    Value.Check(openingSchema, {
      ...opening,
      actions: opening.actions.map((action) =>
        action.type === 'ask' ? { ...action, checkpoint: 'verify' as const } : action,
      ),
    }),
    false,
  );
  assert.equal(
    Value.Check(openingSchema, {
      ...opening,
      actions: [
        ...opening.actions.slice(0, 3),
        { type: 'keypoint_unverified', keypoint_id: 'posterior' },
      ],
    }),
    false,
  );

  const answerSchema = teacherTurnSchemaForContext(context);
  const prematureMastery: TeacherTurnOutput = {
    diagnosis: { status: 'mastered', summary: '已核对。', strategy: '迁移新数字。' },
    actions: [
      { type: 'speak', checkpoint: 'verify', text: '复核回答。' },
      { type: 'keypoint_complete', keypoint_id: 'posterior' },
      { type: 'board', column: 1, card_id: 's11-b1', content: '换一组数字。' },
      { type: 'ask', card_id: 's11-q1', mode: 'open', prompt: '再算一次。' },
    ],
  };
  assert.equal(Value.Check(answerSchema, finalAnswer), true);
  assert.equal(Value.Check(answerSchema, prematureMastery), false);
  assert.equal(
    Value.Check(answerSchema, {
      ...finalAnswer,
      diagnosis: { ...finalAnswer.diagnosis, status: 'mastered' },
    }),
    false,
  );
  assert.equal(
    Value.Check(answerSchema, {
      ...finalAnswer,
      diagnosis: { ...finalAnswer.diagnosis, status: 'opening' },
    }),
    false,
  );
  const insertedAnswer: TeacherTurnOutput = {
    ...finalAnswer,
    diagnosis: { status: 'missing_prereq', summary: '先补前置概念。', strategy: '先按样本分类。' },
    insert_keypoint: {
      id: 'sample-groups',
      title: '样本分组',
      objective: '区分检测阳性和真实患病。',
      depth: 'intuition',
    },
  };
  assert.equal(Value.Check(answerSchema, insertedAnswer), true);
  const cappedInsertionSchema = teacherTurnSchemaForContext({
    ...context,
    progress: { ...context.progress, insertedCount: 2 },
  });
  assert.equal(Value.Check(cappedInsertionSchema, insertedAnswer), false);
  const fullLessonSchema = teacherTurnSchemaForContext({
    ...context,
    keypoints: Array.from({ length: 6 }, (_, index) => ({
      id: `point-${index}`,
      title: `要点 ${index}`,
      objective: '核对样本分类。',
      depth: 'intuition' as const,
      status: index === 0 ? ('active' as const) : ('pending' as const),
    })),
  });
  assert.equal(Value.Check(fullLessonSchema, insertedAnswer), false);

  const verifiedContext: TeacherTurnContext = {
    ...context,
    played: [{ ...previousAsk, checkpoint: 'verify' }],
  };
  const verifiedSchema = teacherTurnSchemaForContext(verifiedContext);
  const completedTurn: TeacherTurnOutput = {
    diagnosis: { status: 'mastered', summary: '迁移正确。', strategy: '核对新例子。' },
    actions: [
      { type: 'board', column: 1, card_id: 's11-b1', content: '替换敏感度后再比较。' },
      { type: 'speak', checkpoint: 'verify', text: '新的数字仍按同一分母计算。' },
      { type: 'keypoint_complete', keypoint_id: 'posterior' },
      { type: 'ask', card_id: 's11-q2', mode: 'open', prompt: '特异度变化会影响哪一项？' },
    ],
  };
  assert.equal(Value.Check(verifiedSchema, completedTurn), true);

  const interruptionContext: TeacherTurnContext = {
    ...context,
    input: { kind: 'interrupt', text: '请沿用刚才的例子继续。' },
  };
  const interruptionSchema = teacherTurnSchemaForContext(interruptionContext);
  const interruption = {
    ...finalAnswer,
    diagnosis: { status: 'clarifying' as const, summary: '先解释。', strategy: '沿用样本。' },
    actions: [
      { type: 'speak' as const, text: '继续从阳性组说明。' },
      { type: 'board' as const, column: 1, card_id: 's11-b1', content: '阳性组包含两类人。' },
      { type: 'speak' as const, text: '真阳性和假阳性都要计入。' },
      { type: 'board' as const, column: 1, card_id: 's11-b2', content: '比较两类人的数量。' },
      {
        type: 'ask' as const,
        card_id: 's11-q1',
        mode: 'open' as const,
        prompt: '改变患病率后会怎样？',
      },
    ],
  };
  assert.equal(Value.Check(interruptionSchema, interruption), true);
  assert.equal(Value.Check(interruptionSchema, prematureMastery), false);
  assert.equal(Value.Check(interruptionSchema, insertedAnswer), false);
  assert.equal(
    Value.Check(interruptionSchema, {
      ...interruption,
      actions: interruption.actions.map((action) =>
        action.type === 'ask' ? { ...action, checkpoint: 'verify' as const } : action,
      ),
    }),
    false,
  );
});

test('teacher layout auto-paginates new keypoints and balances left-to-right columns', async () => {
  const faux = createFauxModelGateway();
  assert.ok(
    faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'layout-test-key' }),
  );
  const completedWithCol1Stack: TeacherTurnOutput = {
    diagnosis: { status: 'mastered', summary: '迁移正确。', strategy: '进入下一要点。' },
    actions: [
      { type: 'speak', checkpoint: 'verify', text: '分母计算准确。' },
      { type: 'keypoint_complete', keypoint_id: 'posterior' },
      {
        type: 'board',
        column: 1,
        card_id: 's11-b1',
        title: '反例情境',
        content: '先看第一组样本。',
      },
      {
        type: 'board',
        column: 1,
        card_id: 's11-b2',
        title: '冲突在哪',
        content: '假阳性占了大头。',
      },
      {
        type: 'board',
        column: 1,
        card_id: 's11-b3',
        title: '对照表',
        content: '把两栏人数并排对比。',
      },
      { type: 'ask', card_id: 's11-q1', mode: 'open', prompt: '哪一栏主导了最终比例？' },
    ],
  };
  faux.setResponses([emit(completedWithCol1Stack)]);
  const verifiedContext: TeacherTurnContext = {
    ...context,
    played: [{ ...previousAsk, checkpoint: 'verify' }],
  };
  const result = await createTeacherPlanner(faux.gateway, [])(verifiedContext, []);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result));
  assert.equal(result.actions[0].type, 'speak');
  assert.equal(result.actions[1].type, 'keypoint_complete');
  assert.equal(result.actions[2].type, 'new_page');
  assert.equal(result.actions[2].title, '特异度');
  const boards = result.actions.filter((action) => action.type === 'board');
  assert.deepEqual(
    boards.map(({ column }) => column),
    [1, 1, 2],
  );
  assert.equal(result.progress.highWater, result.actions.at(-1)?.step_id);
});
