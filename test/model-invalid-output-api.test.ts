import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { type CourseBlueprint, demoCourses } from '@eduharness-studio/engine';
import {
  createFauxModelGateway,
  fauxAssistantMessage,
  fauxToolCall,
} from '@eduharness-studio/engine/models';
import { createServerApp } from '../apps/server/src/app.js';
import { createCourseStore } from '../apps/server/src/course-store.js';
import { openStudioDatabase } from '../apps/server/src/db.js';
import liveInterrupt from './fixtures/m2-5-step-6-interrupt.json' with { type: 'json' };

const outputSecret = 'faux-invalid-output-secret';

function courseFixture(): CourseBlueprint {
  const source = demoCourses[0];
  return {
    ...source,
    id: 'course-model-diagnostics',
    topic: '传感器噪声',
    title: '传感器噪声',
    units: source.units.map((unit, unitIndex) => ({
      ...unit,
      lessons: unit.lessons.map((lesson, lessonIndex) => ({
        ...lesson,
        status: unitIndex === 0 && lessonIndex === 0 ? ('ready' as const) : ('locked' as const),
      })),
    })),
  };
}

function setup(t: TestContext) {
  const database = openStudioDatabase(':memory:');
  const faux = createFauxModelGateway();
  assert.ok(
    faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: 'faux-api-key-only' }),
  );
  const course = courseFixture();
  createCourseStore(database).add(course);
  const app = createServerApp({ database, modelGateway: faux.gateway });
  t.after(() => database.close());
  const structured = (value: unknown) =>
    fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });
  return { app, course, database, faux, structured };
}

const validOpening = {
  diagnosis: { status: 'opening', summary: '先观察读数。', strategy: '重复测量后再比较。' },
  panels: [
    {
      title: '读数的波动',
      content: '同一温度计连续读数会略有差别。',
      highlight: '略有差别',
      voiceover: '先把每次读数都保留下来。',
    },
  ],
  next_ask: { prompt: '多测几次后，你会先比较什么？' },
};

const validLesson = {
  keypoints: [
    { id: 'readings', title: '读数', objective: '区分单次读数和稳定值。', depth: 'intuition' },
    { id: 'noise', title: '噪声', objective: '识别测量误差。', depth: 'definition' },
  ],
  opening: validOpening,
};

test('course unlock 502 returns sanitized model-invalid reasons', async (t) => {
  const { app, course, faux, structured } = setup(t);
  const locked = course.units
    .flatMap(({ lessons }) => lessons)
    .find(({ status }) => status === 'locked');
  assert.ok(locked);
  const invalidLesson = {
    ...validLesson,
    opening: {
      ...validOpening,
      insert_keypoint: {
        id: 'forbidden-opening-insert',
        title: '额外插点',
        objective: '开场不应插入临时要点。',
        depth: 'intuition',
      },
    },
    OPENROUTER_API_KEY: outputSecret,
  };
  faux.setResponses([
    structured(invalidLesson),
    structured(invalidLesson),
    structured(invalidLesson),
  ]);

  const response = await app.request(`/api/courses/${course.id}/lessons/${locked.id}/unlock`, {
    method: 'POST',
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'lesson_generation_failed');
  assert.equal(body.failure, 'course_lesson_invalid_output');
  assert.ok(
    body.reasons.some((reason: string) =>
      reason.includes(
        'model_invalid_output: invalid structured output at $.opening.insert_keypoint',
      ),
    ),
  );
  assert.equal(JSON.stringify(body).includes(outputSecret), false);
  assert.equal(JSON.stringify(body).includes('OPENROUTER_API_KEY'), false);
  assert.equal(faux.state.callCount, 3);
});

function sseFrames(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';
  return async () => {
    while (!buffer.includes('\n\n')) {
      const { done, value } = await reader.read();
      if (done) return undefined;
      buffer += decoder.decode(value, { stream: true });
    }
    const end = buffer.indexOf('\n\n');
    const frame = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    assert.ok(event && data, frame);
    return { event, data: JSON.parse(data) as { action?: { type: string; step_id: number } } };
  };
}

test('teacher 502 and X-Ray expose the same sanitized model-invalid reason', async (t) => {
  const { app, course, faux, structured } = setup(t);
  const first = course.units.flatMap(({ lessons }) => lessons)[0];
  faux.setResponses([structured(validLesson)]);
  const started = await app.request(`/api/courses/${course.id}/lessons/${first.id}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(started.status, 201);
  const { session_id: id, generation } = await started.json();
  const endpoint = `/api/sessions/${id}`;
  const stream = await app.request(`${endpoint}/stream?generation=${generation}`);
  assert.ok(stream.body);
  const reader = stream.body.getReader();
  const nextFrame = sseFrames(reader);
  t.after(async () => {
    await reader.cancel();
  });
  assert.equal((await nextFrame())?.event, 'stream');
  let beat = await nextFrame();
  while (beat?.event === 'beat' && beat.data.action?.type !== 'ask') {
    const stepId = beat.data.action?.step_id;
    assert.ok(stepId);
    const ack = await app.request(`${endpoint}/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ generation, last_played_step_id: stepId }),
    });
    assert.equal(ack.status, 200);
    beat = await nextFrame();
  }
  assert.equal(beat?.event, 'beat');
  assert.equal(beat?.data.action?.type, 'ask');
  const askStepId = beat.data.action.step_id;
  const askAck = await app.request(`${endpoint}/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generation, last_played_step_id: askStepId }),
  });
  assert.equal(askAck.status, 200);

  const invalidAnswer = {
    diagnosis: { status: 'answer_seeking', summary: '继续核对。', strategy: '再换一组数值。' },
    panels: [{ title: '测量误差', content: '读数变化仍围绕稳定值。' }],
    next_ask: { prompt: '怎样判断误差范围？' },
    resolution: { text: '没有回答迁移题。', conclusion: '不应提前记为掌握。' },
    OPENROUTER_API_KEY: outputSecret,
  };
  faux.setResponses([
    structured(invalidAnswer),
    structured(invalidAnswer),
    structured(invalidAnswer),
  ]);
  const failed = await app.request(`${endpoint}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generation, ask_step_id: askStepId, text: '重复测量的范围比较稳定。' }),
  });
  assert.equal(failed.status, 502);
  const body = await failed.json();
  assert.equal(body.error, 'teacher_turn_failed');
  const forbidden =
    'model_invalid_output: invalid structured output at $.resolution: unexpected field';
  assert.ok(body.reasons.includes(forbidden));

  const xrayResponse = await app.request(`${endpoint}/xray`);
  assert.equal(xrayResponse.status, 200);
  const trace = await xrayResponse.json();
  const rejectedTurn = trace.teacherTurns.at(-1);
  assert.equal(rejectedTurn.outcome, 'rejected');
  assert.equal(rejectedTurn.guardrails.length, 3);
  assert.ok(
    rejectedTurn.guardrails.every(({ reasons }: { reasons: string[] }) =>
      reasons.includes(forbidden),
    ),
  );
  for (const payload of [JSON.stringify(body), JSON.stringify(trace)]) {
    assert.equal(payload.includes(outputSecret), false);
    assert.equal(payload.includes('OPENROUTER_API_KEY'), false);
  }
  assert.equal(faux.state.callCount, 4);
});

test('M2.5 beat-6 interrupt replay corrects a bare emit_result before the recorded 502', async (t) => {
  // Anchors and failures: m2.5/live-full/{latest-session.json,latest-xray.json,browser-api-responses.jsonl}.
  // Provider arguments weren't retained. Reconstruct a bare scene that reproduces the recorded
  // envelope error and requires a field-specific correction rather than replaying private text.
  const { app, course, faux } = setup(t);
  const first = course.units[0].lessons[0];
  const bare = (args: Parameters<typeof fauxToolCall>[1]) =>
    fauxAssistantMessage(fauxToolCall('emit_result', args), { stopReason: 'toolUse' });
  const openingDraft = {
    ...validLesson,
    opening: {
      ...validOpening,
      panels: [
        ...validOpening.panels,
        {
          title: '记录测量条件',
          content: '每次读数都标出测量条件。',
          highlight: '测量条件',
          voiceover: '改变条件时，先分别观察。',
        },
      ],
    },
  };
  faux.setResponses([bare(openingDraft)]);
  const post = (path: string, body: object) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const started = await post(`/api/courses/${course.id}/lessons/${first.id}/sessions`, {});
  assert.equal(started.status, 201);
  assert.equal(faux.state.callCount, 1, 'a complete bare lesson needs no corrective POST');
  const { session_id: id, generation } = await started.json();
  assert.equal(generation, liveInterrupt.request.generation);
  const endpoint = `/api/sessions/${id}`;
  const stream = await app.request(`${endpoint}/stream?generation=${generation}`);
  assert.ok(stream.body);
  const reader = stream.body.getReader();
  const nextFrame = sseFrames(reader);
  t.after(async () => reader.cancel());
  assert.equal((await nextFrame())?.event, 'stream');
  for (const [index, type] of liveInterrupt.playedTypes.entries()) {
    const beat = await nextFrame();
    assert.equal(beat?.event, 'beat');
    assert.equal(beat.data.action?.type, type);
    const step = index + 1;
    assert.equal(beat.data.action?.step_id, step);
    assert.equal(
      (await post(`${endpoint}/progress`, { generation, last_played_step_id: step })).status,
      200,
    );
  }

  const scene = {
    diagnosis: { status: 'clarifying', summary: '学生想区分误差。', strategy: '重复测量。' },
    panels: [{ title: '核对读数', content: '先固定测量条件，再比较几次读数。' }],
    next_ask: { prompt: '如何判断哪些读数可比较？' },
  };
  const malformed = bare({ ...scene, panels: [{ ...scene.panels[0], title: false }] });
  const diagnostic = 'invalid structured output at $.panels[0].title: expected a string';
  // With blind prompts the model repeats the malformed submission for all three recorded attempts.
  faux.setResponses(
    liveInterrupt.turn.guardrails.map(
      () =>
        ({ messages }: { messages: readonly { role: string; content: unknown }[] }) =>
          String(messages.find(({ role }) => role === 'user')?.content).includes(diagnostic)
            ? bare(scene)
            : malformed,
    ),
  );
  const before = faux.state.callCount;
  const response = await post(`${endpoint}/interrupt`, {
    ...liveInterrupt.request,
    text: '这些读数为什么会变化？',
  });
  const data = await response.json();
  assert.equal(
    response.status,
    200,
    `must avoid recorded ${liveInterrupt.status} ${liveInterrupt.error}/${liveInterrupt.failure}: ${JSON.stringify(data)}`,
  );
  assert.equal(faux.state.callCount - before, 2);
  const xray = await (await app.request(`${endpoint}/xray`)).json();
  const turn = xray.teacherTurns.at(-1);
  assert.equal(turn.trigger, liveInterrupt.turn.trigger);
  assert.equal(turn.generation, liveInterrupt.turn.generation);
  assert.equal(turn.step_id, liveInterrupt.turn.step_id);
  assert.equal(turn.outcome, 'accepted');
  assert.deepEqual(turn.guardrails, [
    {
      attempt: 1,
      reasons: [...liveInterrupt.turn.guardrails[0].reasons, `model_invalid_output: ${diagnostic}`],
    },
  ]);
});
