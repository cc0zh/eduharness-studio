import { createServer } from 'node:http';

export const modelMockKey = 'synthetic-model-list-sentinel';
export const modelMockList = [
  { id: 'loop/tutor:v1', name: 'Loopback Tutor' },
  { id: 'loop/reasoner:v2', name: 'Loopback Reasoner' },
];

function teacherOutput(status, afterStep) {
  const card = `loopback-${afterStep + 1}`;
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
        prompt: '两组合并后共有多少？',
        options: [
          { id: 'four', label: '4 个' },
          { id: 'five', label: '5 个' },
        ],
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

export async function startModelMock(t, { teacher = false } = {}) {
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
        const corrected = body.messages.some(
          ({ role, content }) =>
            role === 'user' && String(content).includes('上一份回合被护栏拦截'),
        );
        const functionCall =
          teacher &&
          classroom?.input?.kind === 'opening' &&
          hasCalcVerify &&
          !hasToolResult &&
          !corrected
            ? {
                name: 'calc_verify',
                arguments: JSON.stringify({ expression: '2 + 3' }),
              }
            : teacher
              ? {
                  name: 'emit_result',
                  arguments: JSON.stringify({
                    value: teacherOutput(
                      classroom?.input?.kind === 'opening'
                        ? 'opening'
                        : corrected
                          ? 'clarifying'
                          : 'mastered',
                      Number(classroom?.afterStep ?? 0),
                    ),
                  }),
                }
              : {
                  name: 'emit_result',
                  arguments: JSON.stringify({
                    value: 'loopback-ok',
                  }),
                };
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
