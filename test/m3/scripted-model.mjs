import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { sendModelTool } from '../model-mock.mjs';

export const fauxKey = 'synthetic-m3-loopback-only';

export async function startScriptedModel(scene) {
  const calls = [];
  const errors = [];
  let index = 0;
  let anchor;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      errors.push(new Error('Unexpected loopback model request'));
      res.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const prompt = body.messages.find(({ role }) => role === 'user').content;
      const { title, objective, keypoints, opening, rejectedOpening, turns, cut } = scene;
      let value;
      if (prompt.startsWith('Create a specific, concise')) {
        assert.deepEqual(calls, []);
        assert.ok(prompt.includes(scene.topic));
        calls.push('blueprint');
        value = {
          title: scene.topic,
          units: [{ title, lessons: [{ title, summary: objective, depth: 'intuition' }] }],
        };
      } else if (prompt.startsWith('Prepare one concise')) {
        assert.ok(prompt.includes('"id":"u1-l1"'));
        const correction = prompt.includes('The previous submission was invalid');
        assert.equal(correction, calls.includes('opening_rejected'));
        const reject = rejectedOpening && !correction;
        calls.push(reject ? 'opening_rejected' : 'lesson_opening');
        value = {
          keypoints,
          opening: reject
            ? { ...opening, panels: [{ ...opening.panels[0], content: rejectedOpening }] }
            : opening,
        };
      } else {
        const prefix = '课堂输入：';
        const line = prompt.split('\n').find((part) => part.startsWith(prefix));
        assert.ok(line, 'Expected a real Teacher Agent input');
        const context = JSON.parse(line.slice(prefix.length));
        const turn = turns[index];
        assert.ok(turn, 'Unexpected extra teacher turn');
        assert.equal(context.input.kind, turn.kind ?? 'answer');
        assert.equal(context.input.text, turn.input);
        if (cut) {
          assert.ok(
            context.board.some(
              ({ title, step }) => title === cut.anchor && step === context.lastPlayed,
            ),
          );
          assert.ok(context.board.every(({ step }) => step <= context.lastPlayed));
          assert.ok(
            context.dialogue.every(({ evidenceStepIds }) =>
              evidenceStepIds.every((step) => step <= context.lastPlayed),
            ),
          );
          assert.ok(!prompt.includes(cut.unplayed));
          anchor = context.lastPlayed;
        }
        if (turn.calc) {
          const tool = body.messages.find(({ role }) => role === 'tool');
          if (!tool) {
            assert.ok(
              body.tools.some(({ function: definition }) => definition.name === 'calc_verify'),
            );
            calls.push('calc_verify');
            sendModelTool(res, 'calc_verify', { expression: turn.calc.expression });
            return;
          }
          assert.equal(JSON.parse(tool.content).text, turn.calc.result);
        }
        calls.push(context.input.kind);
        index++;
        value = turn.output;
      }
      sendModelTool(res, 'emit_result', { value });
    } catch (error) {
      errors.push(error);
      res.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  return {
    env: {
      STUDIO_MODEL_PROVIDER: 'openai-compatible',
      STUDIO_MODEL_ID: 'loop/m3-tutor',
      STUDIO_MODEL_BASE_URL: base,
      OPENAI_COMPATIBLE_API_KEY: fauxKey,
    },
    endpoint: `${base}/chat/completions`,
    verify(posts) {
      assert.ifError(errors[0]);
      assert.equal(index, scene.turns.length);
      assert.equal(posts, calls.length, 'Reservations and observed loopback POSTs must agree');
      return { calls, ...(anchor === undefined ? {} : { anchor }) };
    },
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
