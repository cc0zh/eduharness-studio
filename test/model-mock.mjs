import { createServer } from 'node:http';

export const modelMockKey = 'synthetic-model-list-sentinel';
export const modelMockList = [
  { id: 'loop/tutor:v1', name: 'Loopback Tutor' },
  { id: 'loop/reasoner:v2', name: 'Loopback Reasoner' },
];

function teacherOutput(status, afterStep, classroom) {
  const card = `loopback-${afterStep + 1}`;
  const measurementLesson = String(classroom?.topic ?? '').includes('温度测量');
  const prompt = measurementLesson ? '报警后的概率应该先看哪一组？' : '两组合并后共有多少？';
  const options = measurementLesson
    ? [
        { id: 'low', label: '分母只包含已经报警的样本' },
        { id: 'high', label: '所有带标签的样本' },
      ]
    : [
        { id: 'four', label: '4 个' },
        { id: 'five', label: '5 个' },
      ];
  return {
    diagnosis: {
      status,
      summary: status === 'opening' ? '先预测合并后的数量。' : '未经历核验，不可宣告掌握。',
      strategy: '用已核对的算式构造直觉选项。',
    },
    actions: [
      {
        type: 'board',
        column: 1,
        card_id: `${card}-board`,
        title: '先观察合并',
        content: '2 + 3 = ?',
      },
      { type: 'speak', text: '把两组物件合在一起，再数一数。' },
      { type: 'highlight', card_id: `${card}-board`, target_text: '2 + 3', style: 'circle' },
      {
        type: 'ask',
        card_id: `${card}-ask`,
        mode: 'choice',
        prompt,
        options,
      },
    ],
  };
}

function teacherContext(body) {
  const prompt = body.messages.find(({ role }) => role === 'user')?.content;
  if (typeof prompt !== 'string') return undefined;
  const marker = '课堂输入：';
  const start = prompt.indexOf(marker);
  if (start < 0) return undefined;
  try {
    return JSON.parse(prompt.slice(start + marker.length).split('\n')[0]);
  } catch {
    return undefined;
  }
}

function modelCourse() {
  return {
    title: '测量数据的学习路线',
    units: [
      {
        title: '先读懂观测',
        lessons: [
          { title: '先看一条记录', summary: '区分读数与测量对象。', depth: 'intuition' },
          { title: '重复测量与噪声', summary: '用多次读数判断波动。', depth: 'definition' },
        ],
      },
      {
        title: '再检验误差',
        lessons: [
          { title: '误差如何传播', summary: '追踪多个测量误差。', depth: 'derivation' },
          { title: '向新场景迁移', summary: '比较不同测量流程。', depth: 'application' },
        ],
      },
    ],
  };
}

function modelLesson(withGraph = false) {
  const label = '分母只包含已经报警的样本';
  return {
    keypoints: [
      {
        id: 'observed-sample',
        title: '观察样本',
        objective: '区分样本读数与真实状态。',
        depth: 'intuition',
      },
      {
        id: 'noise-range',
        title: '辨认波动',
        objective: '说明重复测量的误差范围。',
        depth: 'definition',
      },
    ],
    basis: {
      objective: '利用重复测量辨认噪声，不把单次读数当作规律。',
      examples: ['连续三次温度读数'],
      misconceptions: ['将样本波动误认成真实变化'],
    },
    opening: {
      diagnosis: {
        status: 'opening',
        summary: '先圈定观测集合。',
        strategy: '从已经观测到的样本开始。',
      },
      actions: [
        {
          type: withGraph ? 'graph' : 'board',
          column: 1,
          card_id: 'observed-sample',
          ...(withGraph
            ? {
                title: '样本与阈值',
                depth: 'intuition',
                diagram_kind: 'distribution',
                description: '用轴和阈值说明已报警样本的分布范围，不推算未知数值。',
              }
            : {}),
          content: '先只看已观测的样本，再判断读数代表什么。',
        },
        { type: 'speak', text: '一个读数足够说明真实规律吗？' },
        withGraph
          ? { type: 'speak', text: '先读图上的观测范围，再作判断。' }
          : {
              type: 'highlight',
              card_id: 'observed-sample',
              target_text: '已观测的样本',
              style: 'circle',
            },
        {
          type: 'ask',
          card_id: 'observed-sample-ask',
          mode: 'choice',
          prompt: '报警后的概率应该先看哪一组？',
          options: [
            { id: 'low', label },
            { id: 'high', label: '所有带标签的样本' },
          ],
        },
      ],
    },
  };
}

function teacherAnswer(classroom) {
  const label = classroom.input.text;
  return {
    diagnosis: {
      status: 'clarifying',
      summary: `按选项文字核对：${label}`,
      strategy: '沿着学生指出的样本范围继续推理。',
    },
    actions: [
      { type: 'board', column: 1, card_id: 'label-authority-board', content: label },
      { type: 'speak', text: '你指出了这一组样本，我们据此继续核对。' },
      { type: 'highlight', card_id: 'label-authority-board', target_text: '样本', style: 'circle' },
      {
        type: 'ask',
        card_id: 'label-authority-ask',
        mode: 'open',
        prompt: '下一步应统计哪一部分？',
      },
    ],
  };
}

export async function startModelMock(
  t,
  { teacher = false, courses = true, unlockDelayMs = 0, graph = 'safe' } = {},
) {
  const calls = [];
  const mock = createServer(async (req, res) => {
    calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization });
    switch (req.url) {
      case '/v1/models':
      case '/api/v1/models': {
        const reflected = req.headers.authorization?.slice('Bearer '.length);
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            data: [
              ...modelMockList,
              { id: modelMockList[0].id, name: 'Duplicate' },
              { id: reflected, name: reflected },
              { id: 'safe/echo-name', name: reflected },
            ],
          }),
        );
        break;
      }
      case '/denied/models':
        res.writeHead(401).end(`mock rejected ${modelMockKey}`);
        break;
      case '/bad/models':
        res.end(`invalid response with ${modelMockKey}`);
        break;
      case '/redirect/models':
        res.writeHead(307, { Location: '/unintended/models' }).end();
        break;
      case '/api/v1/messages': {
        const events = [
          {
            type: 'message_start',
            message: {
              id: 'msg_loopback',
              model: '~anthropic/claude-haiku-latest',
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'tool_loopback',
              name: 'emit_result',
              input: {},
            },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"value":"loopback-anthropic-ok"}' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use', stop_sequence: null },
            usage: { output_tokens: 1 },
          },
          { type: 'message_stop' },
        ];
        res.setHeader('Content-Type', 'text/event-stream');
        res.end(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(''),
        );
        break;
      }
      case '/v1/chat/completions': {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        calls.at(-1).body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const body = calls.at(-1).body;
        const hasCalcVerify = body.tools?.some(({ function: tool }) => tool.name === 'calc_verify');
        const hasToolResult = body.messages.some(({ role }) => role === 'tool');
        const classroom = teacher ? teacherContext(body) : undefined;
        const prompt = body.messages.find(({ role }) => role === 'user')?.content;
        const corrected = body.messages.some(
          ({ role, content }) =>
            role === 'user' && String(content).includes('上一份回合被护栏拦截'),
        );
        const drawsGraph = typeof prompt === 'string' && prompt.includes('绘图任务');
        if (drawsGraph && graph === 'timeout')
          await new Promise((resolve) => setTimeout(resolve, 8_000));
        const graphMarkup =
          graph === 'malicious'
            ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" onload="alert(1)"><script/></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" fill="#1A1917"><rect width="100" height="60" fill="#F6F3EC"/><path d="M10 50L90 10" stroke="#A84428" stroke-width="2"/><text x="10" y="55" fill="#4D4943" font-family="sans-serif" font-size="9">样本范围</text></svg>';
        let functionCall;
        if (drawsGraph) {
          functionCall = {
            name: 'emit_result',
            arguments: JSON.stringify({ value: { svg: graphMarkup } }),
          };
        } else if (
          courses &&
          typeof prompt === 'string' &&
          prompt.includes('Create a specific, concise')
        ) {
          functionCall = {
            name: 'emit_result',
            arguments: JSON.stringify({ value: modelCourse() }),
          };
        } else if (
          courses &&
          typeof prompt === 'string' &&
          prompt.includes('Prepare one concise')
        ) {
          if (unlockDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, unlockDelayMs));
          functionCall = {
            name: 'emit_result',
            arguments: JSON.stringify({ value: modelLesson(String(prompt).includes('三角形')) }),
          };
        } else if (
          teacher &&
          classroom?.input?.kind === 'answer' &&
          String(classroom.topic).includes('温度测量')
        ) {
          functionCall = {
            name: 'emit_result',
            arguments: JSON.stringify({ value: teacherAnswer(classroom) }),
          };
        } else if (
          teacher &&
          classroom?.input?.kind === 'opening' &&
          hasCalcVerify &&
          !hasToolResult &&
          !corrected
        ) {
          functionCall = {
            name: 'calc_verify',
            arguments: JSON.stringify({ expression: '2 + 3' }),
          };
        } else if (teacher) {
          functionCall = {
            name: 'emit_result',
            arguments: JSON.stringify({
              value: teacherOutput(
                classroom?.input?.kind === 'opening'
                  ? 'opening'
                  : corrected
                    ? 'clarifying'
                    : 'mastered',
                Number(classroom?.afterStep ?? 0),
                classroom,
              ),
            }),
          };
        } else {
          functionCall = {
            name: 'emit_result',
            arguments: JSON.stringify({ value: 'loopback-ok' }),
          };
        }
        res.setHeader('Content-Type', 'text/event-stream');
        const delta = {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: teacher && functionCall.name === 'calc_verify' ? 'call_calc_verify' : 'call_test',
              type: 'function',
              function: functionCall,
            },
          ],
        };
        res.end(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
        );
        break;
      }
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) =>
    mock.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  t.after(async () => {
    await new Promise((resolve) => {
      mock.close(resolve);
      mock.closeAllConnections();
    });
  });
  return { origin: `http://127.0.0.1:${mock.address().port}`, calls };
}
