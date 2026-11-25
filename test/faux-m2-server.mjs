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
const opening = {
  diagnosis: { status: 'opening', summary: '先观察怎样分组。', strategy: '从具体物件建立直觉。' },
  panels: [
    {
      title: '小物件如何配对',
      content: '先摆出五块积木，试着每两块配成一对。',
      highlight: '五块积木',
      voiceover: '把积木排在桌上，每组只放两块。',
    },
  ],
  next_ask: {
    prompt: '五块积木每两块一组，最后会怎样？',
    options: ['四块成两对，还剩一块', '全部都能配成两对', '我拿不准，想看提示'],
  },
};
const transfer = {
  diagnosis: {
    status: 'clarifying',
    summary: '学生做出了有依据的选择。',
    strategy: '更换数量检验迁移。',
  },
  panels: [
    {
      title: '换一组数量',
      content: '比较六块与七块积木。',
      voiceover: '保留两两配对的方法，这次换成七块。',
    },
  ],
  next_ask: { prompt: '七块积木两两配对，会剩下几块？', transfer: true },
};
const mastered = {
  diagnosis: {
    status: 'mastered',
    summary: '学生把配对方法迁移到了七块。',
    strategy: '核对推理后比较新的组。',
  },
  resolution: {
    text: '七块确实能配成三对。那块没有伙伴的积木，就是换数后仍保留的特征。',
    conclusion: '按两块一对分组后，还有一块找不到伙伴。',
  },
  panels: [
    {
      title: '比较两组物件',
      content: '一组摆五块，另一组摆六块。',
      voiceover: '分别数两组，再观察有什么差异。',
    },
  ],
  next_ask: { prompt: '两组的配对结果有什么不同？' },
};
const prerequisite = {
  diagnosis: {
    status: 'missing_prereq',
    summary: '分组概念尚未建立。',
    strategy: '先插入配对直觉。',
  },
  insert_keypoint: {
    id: 'pre-groups',
    title: '两两配对',
    objective: '能将同类物件每两个分为一组。',
    depth: 'intuition',
  },
  panels: [
    {
      title: '先认识成对',
      content: '两个同类物件放在一起，组成一对。',
      voiceover: '先拿出两块积木，看看它们怎样形成一对。',
    },
  ],
  next_ask: { prompt: '四块积木可以分成几对？' },
};
const scaffold = {
  diagnosis: {
    status: 'low_effort',
    summary: '这次回复尚未包含判断。',
    strategy: '改成轻量二选一。',
  },
  panels: [
    {
      title: '先做个直觉选择',
      content: '摆出两块积木，每组需要两块。',
      voiceover: '先不用写理由，把这两个物件当作一个小组。',
    },
  ],
  next_ask: { prompt: '桌上这两块能不能摆成一对？', options: ['恰好能配成一对', '得各自摆在一边'] },
};
const afterSkip = {
  diagnosis: {
    status: 'low_effort',
    summary: '连续回复仍未显示判断。',
    strategy: '保留未验证状态，用新例子继续。',
  },
  panels: [
    {
      title: '换个数继续观察',
      content: '现在把物件换成六块。',
      voiceover: '比较配对之后桌上还留下什么。',
    },
    { title: '六块积木的另一种排法', content: '把六块积木排成两行，再尝试给它们找伙伴。' },
  ],
  next_ask: { prompt: '六块积木两两配对，单独的积木还有几块？' },
};

let triedIncompleteResolution = false;
function nextOutput(prompt, toolCalls) {
  const lines = prompt.split('\n');
  const context = JSON.parse(
    lines.find((line) => line.startsWith('课堂输入：')).slice('课堂输入：'.length),
  );
  const observations = JSON.parse(
    lines.find((line) => line.startsWith('工具结果：'))?.slice('工具结果：'.length) ?? '[]',
  );
  const { input, currentAsk } = context;
  if (input.kind === 'opening') {
    const count = observations.length + toolCalls;
    if (count < 2)
      return {
        tool: 'mock_calc',
        arguments: { amount: 2 + count, api_key: 'fake-tool-input-secret' },
      };
    return opening;
  }
  if (input.kind === 'interrupt') {
    assert.ok(context.board.some(({ title }) => title === '换个数继续观察'));
    assert.ok(
      context.board.every(
        ({ step }) => Number.isSafeInteger(step) && step > 0 && step <= context.lastPlayed,
      ),
    );
    assert.ok(
      context.dialogue.every(({ evidenceStepIds }) =>
        evidenceStepIds.every((step) => step <= context.lastPlayed),
      ),
    );
    assert.ok(!context.board.some((entry) => 'card_id' in entry || 'step_id' in entry));
    assert.doesNotMatch(prompt, /六块积木的另一种排法|六块积木两两配对，单独的积木还有几块/);
    return {
      diagnosis: {
        status: 'clarifying',
        summary: '学生想换一种表述。',
        strategy: '从已上屏的数量接到图像直觉。',
      },
      panels: [
        {
          title: '沿用桌上的积木',
          content: '每配好一对就把这两块一起移走。',
          voiceover: '把配成对的积木挪到一边，再数桌面上未配对的积木。',
        },
      ],
      next_ask: { prompt: '两组各剩一块时，拼起来还能配对吗？' },
    };
  }
  // Script teaching decisions against the visible question; do not implement an answer grader here.
  switch (currentAsk?.prompt) {
    case opening.next_ask.prompt:
      return transfer;
    case transfer.next_ask.prompt: {
      if (triedIncompleteResolution) return mastered;
      triedIncompleteResolution = true;
      // The malformed draft cannot partially commit; the next attempt supplies its conclusion.
      return { ...mastered, resolution: { text: mastered.resolution.text } };
    }
    case mastered.next_ask.prompt:
      return prerequisite;
    case prerequisite.next_ask.prompt:
      return scaffold;
    case scaffold.next_ask.prompt:
      return afterSkip;
    default:
      throw new Error('Unexpected question in faux teacher scenario');
  }
}

function respond(context) {
  mock.setResponses([respond]);
  const message = context.messages.findLast(({ role }) => role === 'user');
  const prompt = typeof message?.content === 'string' ? message.content : '';
  if (prompt.includes('Create a specific, concise')) {
    return fauxAssistantMessage(
      fauxToolCall('emit_result', {
        value: {
          title: '奇偶性与配对 · 学习路线',
          units: [
            {
              title: '先建立配对直觉',
              lessons: [
                { title: '奇偶性', summary: '从成对物件辨认奇偶性。', depth: 'intuition' },
                { title: '换个数迁移', summary: '把配对方法迁移到新数量。', depth: 'application' },
              ],
            },
          ],
        },
      }),
      { stopReason: 'toolUse' },
    );
  }
  if (prompt.includes('Prepare one concise')) {
    return fauxAssistantMessage(
      fauxToolCall('emit_result', {
        value: {
          keypoints: [
            {
              id: 'pairing',
              title: '两两配对',
              objective: '每两个物件组成一对。',
              depth: 'intuition',
            },
            {
              id: 'odd-even',
              title: '辨认剩余',
              objective: '判断成对后是否有剩余。',
              depth: 'definition',
            },
          ],
          opening,
        },
      }),
      { stopReason: 'toolUse' },
    );
  }
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
