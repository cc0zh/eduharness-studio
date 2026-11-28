import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { sendModelTool } from '../model-mock.mjs';
import c1 from './scenarios/c1-transfer.mjs';
import c2 from './scenarios/c2-pressure.mjs';
import c3 from './scenarios/c3-interrupt.mjs';
import c4 from './scenarios/c4-prereq.mjs';
import {
  cutAskMarker,
  cutMarker,
  liveLoopbackScenes,
  privateDiagnosis,
} from './scenarios/live-loopback-scenes.mjs';

const liveLoopbackKey = 'synthetic-issue-6-live-loopback-only';
const scenes = [c1, c2, c3, c4];
const cutMarkers = [cutMarker, cutAskMarker];

function noPrivateText(prompt, markers) {
  assert.ok(
    markers.every((marker) => !prompt.includes(marker)),
    'Private or cut text reached a model',
  );
}

function simulatedReply(prompt, { lesson, played, ask, index }) {
  const lines = prompt.split('\n');
  const { phase, reply } = lesson.turns[index];
  assert.equal(lines[1], `行为阶段：${phase}`);
  const view = JSON.parse(lines.at(-1));
  const unordered = (question) => {
    if (question?.options) return { ...question, options: [...question.options].sort() };
    return question ?? null;
  };
  // The real compiler shuffles options; their public labels, not the draft order, are the contract.
  assert.deepEqual({ ...view, ask: unordered(view.ask) }, { board: played, ask: unordered(ask) });
  noPrivateText(prompt, [...cutMarkers, privateDiagnosis]);
  return typeof reply === 'function' ? reply(view) : reply;
}

function playDraft(current, output, onlyFirstBeat = false) {
  const { next_ask: next, panels } = output;
  current.played.push(
    ...(onlyFirstBeat ? panels.slice(0, 1) : panels).map((panel) => ({ type: 'board', ...panel })),
  );
  current.ask =
    onlyFirstBeat || !next
      ? undefined
      : {
          prompt: next.prompt,
          ...(next.options && { options: next.options }),
        };
}

export async function startLiveLoopback(
  t,
  { variant = 0, mapOpening = (opening) => opening } = {},
) {
  const lessons = liveLoopbackScenes(variant);
  const finished = new Set();
  const received = [];
  const failures = [];
  let current;

  function respond(prompt, receipt) {
    // A retry here indicates a real contract rejection; don't serve a different turn to hide it.
    const rejection = prompt.split('\n').find((line) => line.startsWith('上次提交'));
    assert.equal(rejection, undefined, 'Loopback teacher draft was rejected');
    if (prompt.startsWith('Create a specific, concise')) {
      const scene = scenes.find(({ topic }) => prompt.includes(topic));
      assert.ok(scene, 'Expected a known loopback lesson topic');
      receipt.scene = scene.id;
      current = { id: scene.id, lesson: lessons[scene.id], played: [], index: 0 };
      return {
        title: scene.topic,
        units: [
          {
            title: scene.title,
            lessons: [{ title: scene.title, summary: scene.objective, depth: 'intuition' }],
          },
        ],
      };
    }
    assert.ok(current, 'Expected a blueprint before lesson generation');
    receipt.scene = current.id;
    const { lesson, index } = current;
    if (prompt.startsWith('Prepare one concise')) {
      assert.equal(current.played.length, 0);
      const opening = mapOpening(lesson.opening);
      playDraft(current, opening, current.id === c3.id);
      return { keypoints: lesson.keypoints, opening };
    }
    const turn = lesson.turns[index];
    assert.ok(turn, 'Unexpected request after the loopback lesson ended');
    if (prompt.startsWith('模拟学生：')) {
      receipt.actor = 'student';
      receipt.phase = turn.phase;
      assert.equal(
        current.reply,
        undefined,
        'Extra student POST before submitting the previous reply',
      );
      current.reply = simulatedReply(prompt, current);
      return { text: current.reply };
    }
    const inputLine = prompt.split('\n').find((line) => line.startsWith('课堂输入：'));
    assert.ok(inputLine, 'Expected real Teacher Agent input');
    const context = JSON.parse(inputLine.slice('课堂输入：'.length));
    const kind = turn.phase === 'interrupt' ? 'interrupt' : 'answer';
    assert.equal(context.input.kind, kind);
    assert.ok(
      current.reply && context.input.text === current.reply,
      'Teacher did not receive the generated student answer',
    );
    if (current.id === c3.id) {
      noPrivateText(prompt, cutMarkers);
      if (kind === 'interrupt') {
        assert.equal(context.lastPlayed, 1);
        assert.equal(context.board.length, 1);
        assert.equal(context.board[0].step, 1);
        assert.equal(context.currentAsk, undefined);
      }
    }
    current.reply = undefined;
    playDraft(current, turn.output);
    if (++current.index === lesson.turns.length) finished.add(current.id);
    return turn.output;
  }

  const server = createServer(async (request, response) => {
    const receipt = { actor: 'teacher' };
    received.push(receipt);
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/chat/completions');
      assert.ok(
        request.headers.authorization === `Bearer ${liveLoopbackKey}`,
        'Wrong loopback authorization',
      );
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { messages } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const { content: prompt } = messages.find(({ role }) => role === 'user');
      assert.equal(typeof prompt, 'string');
      sendModelTool(response, 'emit_result', { value: respond(prompt, receipt) });
    } catch (error) {
      failures.push(error);
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  return {
    endpoint: `${base}/chat/completions`,
    env: {
      STUDIO_MODEL_PROVIDER: 'openai-compatible',
      STUDIO_MODEL_ID: 'loop/issue-6-live-fixture',
      STUDIO_MODEL_BASE_URL: base,
      OPENAI_COMPATIBLE_API_KEY: liveLoopbackKey,
    },
    received,
    verify(expected = Object.keys(lessons)) {
      assert.ifError(failures[0]);
      assert.deepEqual([...finished].sort(), [...expected].sort());
    },
  };
}
