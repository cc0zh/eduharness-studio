import assert from 'node:assert/strict';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
} from '@eduharness-studio/engine/models';
import { serve } from '@hono/node-server';
import { Type } from '@sinclair/typebox';
import { createServerApp } from '../apps/server/src/app.ts';
import { openStudioDatabase } from '../apps/server/src/db.ts';

const mock = createFauxModelGateway();
const database = openStudioDatabase(process.env.STUDIO_DB_PATH ?? ':memory:');
const testOptions = [
  { id: 'one-left', label: '四块成两对，还剩一块' },
  { id: 'all-even', label: '全部都能配成两对' },
  { id: 'hint', label: '我拿不准，想看提示' },
];

function response(
  context,
  {
    status,
    summary,
    strategy,
    title,
    content,
    caption,
    question,
    options,
    checkpoint,
    insert_keypoint,
    outcome,
  },
) {
  const card_id = `pairing-${context.afterStep + 1}`;
  return {
    diagnosis: { status, summary, strategy },
    ...(insert_keypoint ? { insert_keypoint } : {}),
    actions: [
      ...(outcome ?? []),
      { type: 'board', column: 1, card_id, title, content },
      { type: 'speak', text: caption },
      { type: 'board', column: 2, card_id: `${card_id}-example`, content: question },
      {
        type: 'ask',
        card_id: `${card_id}-ask`,
        prompt: question,
        ...(options ? { mode: 'choice', options } : { mode: 'open' }),
        ...(checkpoint ? { checkpoint } : {}),
      },
    ],
  };
}

function nextOutput(prompt, toolCalls = 0) {
  const context = JSON.parse(
    prompt
      .split('\n')
      .find((line) => line.startsWith('课堂输入：'))
      .slice('课堂输入：'.length),
  );
  const observations = JSON.parse(
    prompt
      .split('\n')
      .find((line) => line.startsWith('工具结果：'))
      ?.slice('工具结果：'.length) ?? '[]',
  );
  const { input, activeKeypoint, lowEffortStreak } = context;
  if (input.kind === 'opening') {
    if (observations.length + toolCalls === 0) {
      return { tool: 'mock_calc', arguments: { amount: 2, api_key: 'fake-tool-input-secret' } };
    }
    if (observations.length + toolCalls === 1) {
      return { tool: 'mock_calc', arguments: { amount: 3, api_key: 'fake-tool-input-secret' } };
    }
    return response(context, {
      status: 'opening',
      summary: '先观察怎样分组。',
      strategy: '从具体物件建立直觉。',
      title: '小物件如何配对',
      content: '先摆出五块积木，试着每两块配成一对。',
      caption: '把积木排在桌上，每组只放两块。',
      question: '五块积木每两块一组，最后会怎样？',
      options: testOptions,
    });
  }
  if (input.kind === 'interrupt') {
    assert.ok(context.board.some(({ title }) => title === '换个数继续观察'));
    assert.ok(context.board.every(({ step_id }) => step_id <= context.lastPlayed));
    assert.ok(
      context.dialogue.every(({ evidenceStepIds }) =>
        evidenceStepIds.every((step) => step <= context.lastPlayed),
      ),
    );
    assert.doesNotMatch(prompt, /六块积木两两配对，单独的积木还有几块/);
    return response(context, {
      status: 'clarifying',
      summary: '学生想换一种表述。',
      strategy: '从已上屏的数量接到图像直觉。',
      title: '沿用桌上的积木',
      content: '每配好一对就把这两块一起移走。',
      caption: '把配成对的积木挪到一边，再数桌面上未配对的积木。',
      question: '两组各剩一块时，拼起来还能配对吗？',
    });
  }
  if (context.effortSignal && (lowEffortStreak || context.effortSignal === 'skip')) {
    return response(context, {
      status: 'low_effort',
      summary: '连续回复仍未显示判断。',
      strategy: '标为未验证并继续。',
      title: '换个数继续观察',
      content: '现在把物件换成六块。',
      caption: '把两个例子放在一起，比较配对之后剩余的物件。',
      question: '六块积木两两配对，单独的积木还有几块？',
      outcome: [
        { type: 'speak', text: '每组只放两块，这是下一个例子会用到的线索。' },
        { type: 'keypoint_unverified', keypoint_id: activeKeypoint },
      ],
    });
  }
  if (context.effortSignal) {
    return response(context, {
      status: 'low_effort',
      summary: '这次回复尚未包含判断。',
      strategy: '改成轻量二选一。',
      title: '先做个直觉选择',
      content: '摆出两块积木，每组需要两块。',
      caption: '先不用写理由，把这两个物件当作一个小组。',
      question: '桌上这两块能不能摆成一对？',
      options: [
        { id: 'pair', label: '恰好能配成一对' },
        { id: 'apart', label: '得各自摆在一边' },
      ],
    });
  }
  if (input.text.includes('前置知识')) {
    return response(context, {
      status: 'missing_prereq',
      summary: '分组概念尚未建立。',
      strategy: '先插入配对直觉。',
      title: '先认识成对',
      content: '两个同类物件放在一起，组成一对。',
      caption: '先拿出两块积木，看看它们怎样形成一对。',
      question: '四块积木可以分成几对？',
      insert_keypoint: {
        id: 'pre-groups',
        title: '两两配对',
        objective: '能将同类物件每两个分为一组。',
        depth: 'intuition',
      },
    });
  }
  if (context.currentAsk?.checkpoint === 'verify') {
    // First try to pass without a spoken check. The same answer only commits the corrected batch.
    const outcome = [
      {
        type: 'keypoint_complete',
        keypoint_id: activeKeypoint,
        summary: '能在新数量下找出剩余的一块。',
      },
    ];
    if (prompt.includes('immediately before completion')) {
      outcome.unshift({
        type: 'speak',
        checkpoint: 'verify',
        text: '七块确实能配成三对。那块没有伙伴的积木，就是本题改变数量后仍保留的特征。',
      });
    }
    return response(context, {
      status: 'mastered',
      summary: '学生把配对方法迁移到了七块。',
      strategy: '核对推理后比较新的组。',
      title: '比较两组物件',
      content: '一组摆五块，另一组摆六块。',
      caption: '分别数两组，再观察有什么差异。',
      question: '两组的配对结果有什么不同？',
      outcome,
    });
  }
  return response(context, {
    status: 'clarifying',
    summary: '学生做出了有依据的选择。',
    strategy: '更换数量检验迁移。',
    title: '换一组数量',
    content: '比较六块与七块积木。',
    caption: '保留两两配对的方法，这次换成七块。',
    question: '七块积木两两配对，会剩下几块？',
    checkpoint: 'verify',
  });
}

function respond(context) {
  mock.setResponses([respond]);
  const message = context.messages.findLast(({ role }) => role === 'user');
  const prompt = typeof message?.content === 'string' ? message.content : '';
  const toolCalls = context.messages.filter(
    (entry) => entry.role === 'toolResult' && entry.toolName === 'mock_calc',
  ).length;
  const value = nextOutput(prompt, toolCalls);
  const call =
    value && typeof value === 'object' && 'tool' in value
      ? fauxToolCall(value.tool, value.arguments)
      : fauxToolCall('emit_result', { value });
  return fauxAssistantMessage(call, { stopReason: 'toolUse' });
}

mock.setResponses([respond]);
const app = createServerApp({
  database,
  modelGateway: mock.gateway,
  teacherTools: [
    {
      name: 'mock_calc',
      description: 'A test-only faux calculation hook.',
      parameters: Type.Object({ amount: Type.Number(), api_key: Type.String() }),
      run: ({ amount }) => ({
        amount,
        sum: amount + amount,
        api_key: 'fake-tool-result-secret',
        note: 'test only',
      }),
    },
  ],
});

const server = serve(
  { fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 0) },
  (info) => {
    console.log(
      `[server] eduharness-studio listening on http://127.0.0.1:${info.port} (faux M2-2 browser fixture)`,
    );
  },
);
function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
