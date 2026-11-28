import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { createLiveStudent } from './m3/live-student.mjs';

const key = 'SyntheticJudgeKeyShouldNeverAppear';
const played = [
  { type: 'board', step_id: 1, title: '价格', content: '乙店折后 7 元', formula: '10-3' },
  { type: 'ask', step_id: 2, prompt: '以前的提问', options: [{ label: '旧选项' }] },
  { type: 'highlight', step_id: 3, target_text: '折后 7 元' },
  {
    type: 'ask',
    step_id: 4,
    prompt: '乙店会员的价格是多少？',
    options: [
      { id: 'usual', label: '十元' },
      { id: 'member', label: '七元' },
    ],
    checkpoint: 'verify',
  },
];
const snapshot = {
  state: 'handoff',
  askStep: 4,
  last_played_step_id: 4,
  playedActions: [...played, { type: 'board', step_id: 5, content: '未确认的答案' }],
  records: [{ text: '早先的输入' }],
  teacherTurns: [{ diagnosis: '隐藏诊断' }],
  queued: [{ content: '待播队列' }],
  keypoints: [{ title: '私有规划' }],
};

test('M3 student gets only acknowledged whiteboard material and the current question', async () => {
  const signal = new AbortController().signal;
  const student = createLiveStudent(
    {
      async generate(input) {
        assert.match(input.prompt, /行为阶段：near_transfer/);
        assert.deepEqual(JSON.parse(input.prompt.split('\n').at(-1)), {
          board: [{ type: 'board', title: '价格', content: '乙店折后 7 元', formula: '10-3' }],
          ask: { prompt: played[3].prompt, options: ['十元', '七元'] },
        });
        assert.doesNotMatch(
          input.prompt,
          /隐藏诊断|未确认的答案|待播队列|早先的输入|以前的提问|私有规划/,
        );
        assert.equal(input.signal, signal);
        assert.equal(input.attempts, 1);
        assert.equal(input.maxTokens, 256);
        assert.equal(Value.Check(input.schema, { text: '  ' }), false);
        assert.equal(Value.Check(input.schema, { text: '字'.repeat(501) }), false);
        assert.equal(Value.Check(input.schema, { text: '七元', diagnosis: 'hidden' }), false);
        return { value: { text: '  七元，因为 10 减 3。  ' } };
      },
    },
    [key],
  );
  assert.equal(await student('near_transfer', snapshot, signal), '七元，因为 10 减 3。');
});

test('M3 student refuses unconfirmed questions and never forwards or returns credentials', async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  const student = createLiveStudent(
    {
      async generate() {
        calls++;
        return { value: { text: `供应商回显 ${key}` } };
      },
    },
    [key],
  );
  await assert.rejects(
    student('follow', { ...snapshot, askStep: 2 }, signal),
    /on-screen interaction/,
  );
  const leakingSnapshot = {
    ...snapshot,
    playedActions: [...played.slice(0, 3), { ...played[3], prompt: key }],
  };
  const refusal = { status: 'student_failed', message: 'unsafe_student_text' };
  await assert.rejects(student('follow', leakingSnapshot, signal), refusal);
  assert.equal(calls, 0);
  await assert.rejects(student('follow', snapshot, signal), refusal);
  assert.equal(calls, 1);
});

test('M3 student drops provider error details and does not dispatch on an aborted signal', async () => {
  let calls = 0;
  const student = createLiveStudent(
    {
      async generate() {
        calls++;
        throw new Error(key);
      },
    },
    [key],
  );
  await assert.rejects(student('follow', snapshot, new AbortController().signal), (error) => {
    assert.equal(error.status, 'student_failed');
    assert.equal(error.message, 'student_generation_failed');
    assert.equal(error.cause, undefined);
    return true;
  });
  await assert.rejects(student('follow', snapshot, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(calls, 1);
});
