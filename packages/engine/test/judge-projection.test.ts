import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Action,
  JudgeProjectionError,
  type LessonRecord,
  projectEvidenceMessages,
  projectPlayedDialogue,
} from '../src/index.js';

const fraction = String.raw`\frac{1}{3}`;
const frames: Action[] = [
  { type: 'board', step_id: 1, column: 1, card_id: 'b', content: '等分', formula: fraction },
  {
    type: 'graph',
    step_id: 2,
    column: 2,
    card_id: 'g',
    title: '线段图',
    svg_markup: '<svg>RAW_MARKUP_NOT_EVIDENCE</svg>',
    formula: fraction,
  },
  {
    type: 'ask',
    step_id: 3,
    card_id: 'a',
    prompt: '哪份更长？',
    mode: 'choice',
    options: [
      { id: 'first', label: '第一份' },
      { id: 'second', label: '第二份' },
    ],
  },
  { type: 'keypoint_unverified', step_id: 7, keypoint_id: 'recognition' },
  { type: 'keypoint_complete', step_id: 8, keypoint_id: 'comparison', summary: '同样长才可比较' },
  { type: 'speak', step_id: 9, text: 'UNPLAYED_TAIL_CANARY' },
];
const answer = { kind: 'answer', generation: 1, ask_step_id: 3, text: '第一份' } as const;
const interrupt: LessonRecord = {
  kind: 'interrupt',
  generation: 2,
  previous_generation: 1,
  last_played_step_id: 3,
  truncated_step_ids: [4, 5, 6],
  intent: 'explain',
  text: '请换种方式讲。',
};
const input: Parameters<typeof projectEvidenceMessages>[0] = {
  topic: '分数',
  lesson: { title: '比较分数大小', summary: '解释等长条件。' },
  basisObjective: '用等分建立直觉。',
  played: frames,
  lastPlayedStepId: 8,
  records: [answer, interrupt],
};

test('judge intro is deterministic and every later message comes from the X-Ray public turns', () => {
  const transcript = projectEvidenceMessages(input);
  assert.equal(JSON.stringify(transcript), JSON.stringify(projectEvidenceMessages(input)));
  assert.deepEqual(transcript[0], {
    id: 'm1',
    role: 'learner',
    turn: 0,
    text: '课程主题：分数\n课节：比较分数大小\n入课目标：解释等长条件。\n轻调研目标：用等分建立直觉。',
  });
  assert.deepEqual(
    transcript.map(({ id, role, turn }) => [id, role, turn]),
    [
      ['m1', 'learner', 0],
      ['m2', 'teacher', 1],
      ['m3', 'learner', 1],
      ['m4', 'teacher', 2],
    ],
  );
  assert.deepEqual(
    transcript.slice(1).map(({ role, text }) => ({ role, text })),
    projectPlayedDialogue(frames.slice(0, -1), input.records).turns.map(
      ({ role, text, interrupted }) => ({
        role,
        text: interrupted ? `[含插话]\n${text}` : text,
      }),
    ),
  );
  assert.ok(transcript[1].text.includes(`${fraction}\n[图示: 线段图] 公式: ${fraction}`));
  assert.match(transcript[1].text, /\[提问\] 哪份更长？\n选项: 第一份 \/ 第二份/);
  assert.equal(transcript[2].text, '[含插话]\n第一份\n请换种方式讲。');
  assert.equal(transcript[3].text, '[要点未验证]\n[过关] 同样长才可比较');
  assert.doesNotMatch(JSON.stringify(transcript), /UNPLAYED_TAIL_CANARY|RAW_MARKUP_NOT_EVIDENCE/);
});

test('keeps a real cursor-0 interruption with the opening goal, not a fake teacher reply', () => {
  const initial = { ...interrupt, last_played_step_id: 0 };
  const transcript = projectEvidenceMessages({ ...input, records: [initial, answer] });
  assert.equal(transcript[0].text.split('\n\n')[1], '[含插话]\n请换种方式讲。');
  assert.equal(transcript[1].role, 'teacher');
  assert.equal(transcript[2].text, answer.text);
});

test('three messages are accepted when the real answer has no played reply yet', () => {
  const transcript = projectEvidenceMessages({ ...input, records: [answer], lastPlayedStepId: 3 });
  assert.equal(transcript.length, 3);
  assert.deepEqual(transcript.at(-1), { id: 'm3', role: 'learner', turn: 1, text: answer.text });
});

test('public turns retain a completion without a summary alongside speech', () => {
  const played: Action[] = [
    ...frames.slice(0, 3),
    { type: 'speak', step_id: 4, text: '核对解释。' },
    { type: 'keypoint_complete', step_id: 5, keypoint_id: 'recognition' },
  ];
  const records = [answer];
  const transcript = projectEvidenceMessages({ ...input, played, records, lastPlayedStepId: 5 });
  assert.equal(transcript.at(-1)?.text, '核对解释。\n[要点过关]');
  assert.equal(projectPlayedDialogue(played, records).turns.at(-1)?.text, transcript.at(-1)?.text);
  assert.equal(
    projectPlayedDialogue(played, records, 'teacher-context').turns.at(-1)?.text,
    '核对解释。',
  );
});

function rejects(change: Partial<typeof input>, code: JudgeProjectionError['code']) {
  assert.throws(
    () => projectEvidenceMessages({ ...input, ...change }),
    (error) =>
      error instanceof JudgeProjectionError && error.code === code && error.message === code,
  );
}

test('refuses an empty lesson, no real input, and fewer than three messages with distinct codes', () => {
  rejects({ played: [], lastPlayedStepId: 0, records: [] }, 'empty_lesson');
  rejects({ records: [{ ...answer, text: ' ' }] }, 'no_student_interaction');
  rejects({ records: [{ ...interrupt, last_played_step_id: 0 }] }, 'insufficient_dialogue');
});

test('refuses a missing cursor, missing or not-yet-played input anchor, or out-of-order records', () => {
  rejects({ lastPlayedStepId: 10 }, 'cursor_mismatch');
  rejects({ lastPlayedStepId: 2 }, 'cursor_mismatch');
  rejects({ records: [{ ...answer, ask_step_id: 2 }] }, 'cursor_mismatch');
  rejects({ records: [{ ...interrupt, last_played_step_id: 4 }] }, 'cursor_mismatch');
  rejects({ records: [{ ...interrupt, last_played_step_id: 7 }, answer] }, 'cursor_mismatch');
  rejects({ records: [{ ...interrupt, truncated_step_ids: [7] }] }, 'cursor_mismatch');
  rejects({ played: [frames[1], ...frames] }, 'cursor_mismatch');
});

test('fails closed on recognizable credential text and unreportable code units, without echoing either', () => {
  rejects(
    { records: [{ ...answer, text: 'OPENAI_API_KEY="synthetic-value-123"' }] },
    'credential_detected',
  );
  rejects({ records: [{ ...answer, text: 'contains\0nul' }] }, 'invalid_evidence_text');
  rejects({ topic: 'contains\uD800unpaired' }, 'invalid_evidence_text');
  assert.ok(projectEvidenceMessages({ ...input, topic: '积木 🧱' })[0].text.includes('🧱'));
});
