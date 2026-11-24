import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Action,
  emptyOfflineAnswers,
  evaluateOfflineQuality,
  type LessonRecord,
  OFFLINE_DIMENSIONS,
  OFFLINE_QUESTION_IDS,
  type OfflineQuestion,
  projectPlayedDialogue,
  scoreOfflineAnswers,
  type TeachingTransition,
} from '../src/index.js';

const dimensions = {
  misconception_repair: ['M0', 'M1', 'M2', 'M3'],
  support_escalation_and_fading: ['S0', 'S1', 'S2', 'S3'],
  agency_handoff: ['A1', 'A2'],
  productive_struggle: ['P0', 'P1', 'P2', 'P3'],
  representation_pivot: ['R0', 'R1', 'R2'],
  verification_or_transfer: ['V1', 'V2'],
};

test('e1-binary-v3 has exactly 19 questions with the original dimension mapping and N/A gates', () => {
  const result = evaluateOfflineQuality(projectPlayedDialogue([], []), [], [], []);
  assert.equal(result.ruler, 'e1-binary-v3');
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(OFFLINE_DIMENSIONS).map(([id, def]) => [id, Object.keys(def.questions)]),
    ),
    dimensions,
  );
  assert.equal(new Set(OFFLINE_QUESTION_IDS).size, 19);
  assert.deepEqual(Object.keys(result.answers), Object.values(dimensions).flat());
  for (const answer of Object.values(result.answers))
    assert.deepEqual(answer, { score: 0, evidence: null });
  assert.deepEqual(Object.values(result.scoring.scores), ['N/A', 'N/A', 0, 'N/A', 'N/A', 0]);
  assert.deepEqual(result.scoring.applicable, ['agency_handoff', 'verification_or_transfer']);
  assert.deepEqual(
    [result.scoring.points, result.scoring.possible, result.scoring.rate],
    [0, 4, 0],
  );
});

const board = (step_id: number, content: string, title?: string): Action => ({
  type: 'board',
  step_id,
  card_id: `card-${step_id}`,
  column: 1,
  content,
  ...(title ? { title } : {}),
});
const ask = (step_id: number, prompt: string, hint?: string): Action => ({
  type: 'ask',
  step_id,
  card_id: `ask-${step_id}`,
  mode: 'open',
  prompt,
  ...(hint ? { hint } : {}),
});
const verify = (step_id: number): Action => ({
  type: 'speak',
  step_id,
  checkpoint: 'verify',
  text: '现在核对刚才的依据。',
});
const event = (step_id: number): TeachingTransition => ({
  from: 'handoff',
  to: 'verify',
  step_id,
  generation: 2,
});
const answer = (ask_step_id: number, text: string, generation = 2): LessonRecord => ({
  kind: 'answer',
  generation,
  ask_step_id,
  text,
});
const interrupt: LessonRecord = {
  kind: 'interrupt',
  generation: 2,
  previous_generation: 1,
  last_played_step_id: 2,
  truncated_step_ids: [3, 4],
  intent: 'explain',
  text: '我以为两个分母一定等于。现在卡在这里。',
};

function observe(
  actions: Action[],
  records: LessonRecord[],
  transitions: TeachingTransition[] = [],
) {
  const dialogue = projectPlayedDialogue(actions, records);
  const result = evaluateOfflineQuality(dialogue, actions, records, transitions);
  for (const { evidence } of Object.values(result.answers)) {
    for (const anchor of Object.values(evidence ?? {})) {
      const steps = dialogue.turns[anchor - 1].evidenceStepIds;
      assert.ok(
        steps.length && steps.every((step) => actions.some((action) => action.step_id === step)),
      );
    }
  }
  return result;
}

test('explicitly blocked learner, scaffold, repair and a verified follow-up bind the 15 positive observations', () => {
  const actions = [
    board(1, '100 件样品。'),
    ask(2, '比一比两种概率。', '先找总数。'),
    board(5, '想象两道筛门；先画出口，两个总数不是同一群体。', '辨析误解'),
    ask(6, '理由是什么？'),
    verify(7),
    ask(8, '换一个条件后会怎样？'),
    verify(9),
  ];
  const records = [
    interrupt,
    answer(6, '原来要用不同筛门，因为纳入的群体不相同。'),
    answer(8, '我选择用另一组来检验，因为两个分母独立；我算出新结果会变。'),
  ];
  const reports = observe(actions, records, [event(7), event(9)]);
  assert.deepEqual(observe(actions, records, [event(7), event(9)]), reports);
  const { answers, scoring } = reports;
  assert.deepEqual(
    OFFLINE_QUESTION_IDS.filter((id) => answers[id].score === 0),
    ['M3', 'S3', 'P1', 'P3'],
  );
  assert.deepEqual(answers.S1.evidence, { initial: 1, blocked: 2, escalation: 3 });
  assert.deepEqual(answers.S2.evidence, { prior: 3, progress: 4, fading: 5, followup: 6 });
  assert.deepEqual(answers.A1.evidence, { step: 6 });
  assert.deepEqual(answers.R2.evidence, { newFrame: 3, uptake: 4 });
  assert.deepEqual(answers.V2.evidence, { prompt: 3, response: 4 });
  assert.deepEqual(Object.values(scoring.scores), [2, 2, 2, 2, 2, 2]);
  assert.deepEqual([scoring.points, scoring.possible, scoring.rate], [12, 12, 1]);
  const withoutEvents = observe(actions, records);
  assert.equal(withoutEvents.answers.V2.score, 0);
  assert.equal(withoutEvents.answers.S2.score, 0);
});

test('an opening worked solution forces P1 on the same turn; later takeover and premature repair are cited', () => {
  const { answers, scoring } = observe(
    [
      board(1, '完整解：设式，直接完成原题。'),
      ask(2, '是否理解？'),
      board(5, '完整解：再替你解掉刚才卡住的原题。'),
    ],
    [interrupt],
  );
  assert.deepEqual(answers.S3.evidence, { opening: 1 });
  assert.deepEqual(answers.P1, answers.S3);
  assert.deepEqual(answers.M3.evidence, { misconception: 2, solution: 3 });
  assert.deepEqual(answers.P3.evidence, { prior: 1, pending: 2, rescue: 3 });
  assert.equal(scoring.scores.misconception_repair, 0);
  assert.equal(scoring.scores.productive_struggle, 0);
  const onlyAnswer = observe([board(1, '答案是 42。'), ask(2, '是否理解？')], []);
  assert.equal(onlyAnswer.answers.S3.score, 0);
  assert.equal(onlyAnswer.answers.P1.score, 1);
});

test('an opening hint alone is not S1; fading needs a follow-up; parroting does not prove verification', () => {
  const actions = [
    ask(1, '为什么成立？', '看条件。'),
    verify(2),
    ask(3, '说说如果换个条件会怎样？'),
  ];
  const input = answer(1, '因为可选范围发生了变化。');
  const noFollowup = observe(actions, [input], [event(2)]);
  assert.equal(noFollowup.answers.S2.score, 0);
  const fading = observe(actions, [input, answer(3, '因为总量需要重新计算。')], [event(2)]);
  assert.equal(fading.answers.S1.score, 0);
  assert.equal(fading.answers.S2.score, 1);
  assert.deepEqual(fading.answers.S2.evidence, { prior: 1, progress: 2, fading: 3, followup: 4 });
  assert.equal(fading.scoring.scores.support_escalation_and_fading, 1);
  assert.equal(observe(actions, [answer(1, '懂了')], [event(2)]).answers.V2.score, 0);
  const echo = [board(1, '因为条件变了，总量也变了。'), ask(2, '理由是什么？'), verify(3)];
  assert.equal(
    observe(echo, [answer(2, '因为条件变了，总量也变了。')], [event(3)]).answers.V2.score,
    0,
  );
});

test('the v3 scorer uses same-chain references and penalties, not counts of Yes answers', () => {
  const answers = emptyOfflineAnswers();
  const references: Partial<Record<OfflineQuestion, Record<string, number>>> = {
    M0: { misconception: 2 },
    M1: { explanation: 7 },
    M2: { repair: 4 },
    S0: { state: 2 },
    S1: { escalation: 3 },
    S2: { prior: 5 },
    A1: { step: 8, choice: 6 },
    A2: { choice: 6 },
    P0: { task: 2 },
    P2: { attempt: 4 },
    P3: { rescue: 7 },
    R0: { blocked: 2 },
    R1: { newFrame: 3 },
    V1: { prompt: 5 },
    V2: { prompt: 7, response: 8 },
  };
  for (const id of OFFLINE_QUESTION_IDS) {
    const evidence = references[id];
    if (evidence) answers[id] = { score: 1, evidence };
  }
  assert.deepEqual(Object.values(scoreOfflineAnswers(answers).scores), [1, 1, 2, 1, 1, 1]);
  answers.S2 = { score: 1, evidence: { prior: 3 } };
  assert.equal(scoreOfflineAnswers(answers).scores.support_escalation_and_fading, 2);
  answers.S3 = { score: 1, evidence: { opening: 1 } };
  answers.P1 = { score: 1, evidence: { opening: 1 } };
  assert.equal(scoreOfflineAnswers(answers).scores.support_escalation_and_fading, 1);
  assert.equal(scoreOfflineAnswers(answers).scores.productive_struggle, 0);
  answers.V1 = { score: 0, evidence: null };
  assert.equal(scoreOfflineAnswers(answers).scores.verification_or_transfer, 0);
});
