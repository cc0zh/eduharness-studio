import { observeRounds, type Round } from './offline-observations.js';
import {
  emptyOfflineAnswers,
  type OfflineAnswers,
  type QuestionEvidenceWriter,
  scoreOfflineAnswers,
} from './offline-rubric.js';
import type { PlayedDialogue } from './projection.js';
import type { Action } from './protocol.js';
import type { LessonRecord } from './session-protocol.js';
import type { TeachingTransition } from './state.js';

export interface OfflineQualityReport {
  ruler: 'e1-binary-v3';
  mode: 'offline-rules';
  answers: OfflineAnswers;
  scoring: ReturnType<typeof scoreOfflineAnswers>;
}

export interface SessionQuality extends OfflineQualityReport {
  generation: number;
  last_played_step_id: number;
  dialogue: PlayedDialogue;
}

const reasoning =
  /(?:因为|所以|由于|依据|因此|分子.{1,24}分母|分母.{1,24}分子|\bbecause\b|\btherefore\b).{2}/iu;
const repairSignal = /原来|我(?:刚才|之前).{0,12}(?:错|混淆)|改成|不应该|my mistake/iu;
const proposedError =
  /(?:我以为|我猜|我认为|i thought).{1,42}(?:一定|等于|就是|只要|不需要|would always|equals)/iu;
const choice =
  /(?:我(?:选择|决定|改用|会先用|想用|打算用|先做一个检验)|\bi (?:chose|decided to|would check)\b)/iu;
const proposalOnly = /(?:打算|想试|想用|would try|i plan)/iu;
const execution = /(?:算出|得到|检验后|我发现|得出|说明了|结果是|得一半|=|obtained|found that)/iu;
const checkPrompt =
  /(?:为什么|理由|请解释|判断.{1,50}对不对|说说|换.{0,8}(?:条件|例子)|\bwhy\b|\bexplain\b|\bwhat if\b)/iu;
const spontaneousCheck =
  /(?:我(?:检验过|核对过|试了另一种)|换.{0,6}(?:条件|例子).{2,}|i checked)/iu;
const mappedFrame = /(?:图|面积|色块|两行|筛门|表格|例子|类比|\bdiagram\b|\bgraph\b)/iu;

function reasons(text = '') {
  return reasoning.test(text) && (!proposalOnly.test(text) || execution.test(text));
}

function attempt(text = '') {
  return reasons(text) || /\d|不算|算进|包括|应当|should/iu.test(text);
}

function open(round: Round) {
  return round.ask?.mode === 'open' && !round.reveal && !round.takeover;
}

type Exchange = { prior: Round; learner: NonNullable<Round['learner']>; next: Round };

function exchangesFor(rounds: readonly Round[]): Exchange[] {
  return rounds.flatMap((prior, i) => {
    const learner = prior.learner;
    const next = rounds[i + 1];
    return learner && next ? [{ prior, learner, next }] : [];
  });
}

function misconception(exchanges: readonly Exchange[], yes: QuestionEvidenceWriter) {
  const opportunity = exchanges.find(({ learner }) =>
    proposedError.test(learner.reply ?? learner.text),
  );
  if (!opportunity) return;
  const { learner, next } = opportunity;
  yes('M0', { misconception: learner.n });
  if (next.correction) yes('M1', { misconception: learner.n, explanation: next.n });
  if (next.fullSolution) yes('M3', { misconception: learner.n, solution: next.n });
  const repair = next.learner?.reply ?? '';
  if (next.learner && reasons(repair) && repairSignal.test(repair)) {
    yes('M2', { misconception: learner.n, repair: next.learner.n });
  }
}

function support(
  exchanges: readonly Exchange[],
  opening: Round | undefined,
  yes: QuestionEvidenceWriter,
) {
  if (opening?.fullSolution) yes('S3', { opening: opening.n });
  const pending = exchanges.find(
    ({ learner, next }) => learner.blocked || (reasons(learner.reply) && open(next)),
  );
  if (!pending) return;
  yes('S0', { state: pending.learner.n });
  const increased = ({ prior, learner, next }: Exchange) =>
    prior.hint &&
    learner.blocked &&
    open(next) &&
    (next.hint || (next.frame !== undefined && next.frame !== prior.frame));
  const candidates = exchanges.filter(increased);
  const faded = ({ prior, learner, next }: Exchange) =>
    (prior.hint || candidates.some((item) => item.next === prior)) &&
    reasons(learner.reply) &&
    next.verify &&
    open(next) &&
    !next.hint &&
    reasons(next.learner?.reply);
  const paired = candidates.find((item) =>
    exchanges.some((other) => other.prior === item.next && faded(other)),
  );
  const escalation = paired ?? candidates[0];
  if (escalation)
    yes('S1', {
      initial: escalation.prior.n,
      blocked: escalation.learner.n,
      escalation: escalation.next.n,
    });
  const fading =
    exchanges.find((item) => item.prior === escalation?.next && faded(item)) ??
    exchanges.find(faded);
  if (fading?.next.learner)
    yes('S2', {
      prior: fading.prior.n,
      progress: fading.learner.n,
      fading: fading.next.n,
      followup: fading.next.learner.n,
    });
}

function agency(rounds: readonly Round[], length: number, yes: QuestionEvidenceWriter) {
  const replies = rounds.flatMap(({ learner }) =>
    learner?.reply ? [{ n: learner.n, text: learner.reply }] : [],
  );
  const method = replies.find(
    ({ n, text }) => n > Math.floor((length * 2) / 3) && choice.test(text) && reasoning.test(text),
  );
  if (method) yes('A2', { choice: method.n });
  const worked =
    replies.find(({ n, text }) => n === method?.n && reasons(text)) ??
    replies.find(({ text }) => reasons(text));
  if (worked) yes('A1', { step: worked.n });
}

function struggle(
  exchanges: readonly Exchange[],
  opening: Round | undefined,
  yes: QuestionEvidenceWriter,
) {
  if (opening?.reveal) yes('P1', { opening: opening.n });
  const opportunity = exchanges.find(
    ({ prior, learner, next }) =>
      learner.blocked || (prior.ask && !reasons(learner.reply) && open(next)),
  );
  if (!opportunity) return;
  yes('P0', { task: opportunity.learner.n });
  const coaching = exchanges.find(
    ({ learner, next }) =>
      learner.blocked && open(next) && next.hint && attempt(next.learner?.reply),
  );
  if (coaching?.next.learner)
    yes('P2', {
      stuck: coaching.learner.n,
      hint: coaching.next.n,
      attempt: coaching.next.learner.n,
    });
  const rescue = exchanges.find(
    ({ learner, next }) => learner.blocked && !next.verify && (next.takeover || next.reveal),
  );
  if (rescue)
    yes('P3', { prior: rescue.prior.n, pending: rescue.learner.n, rescue: rescue.next.n });
}

function representation(exchanges: readonly Exchange[], yes: QuestionEvidenceWriter) {
  const opportunities = exchanges.filter(
    ({ prior, learner }) => prior.frame !== undefined && learner.blocked,
  );
  const pivot = opportunities.find(
    ({ prior, next }) => next.frame !== undefined && next.frame !== prior.frame,
  );
  const opportunity = pivot ?? opportunities[0];
  if (!opportunity) return;
  const anchors = { oldFrame: opportunity.prior.n, blocked: opportunity.learner.n };
  yes('R0', anchors);
  if (!pivot) return;
  yes('R1', { ...anchors, newFrame: pivot.next.n });
  const reply = pivot.next.learner;
  if (reply?.reply && mappedFrame.test(reply.reply) && reasons(reply.reply)) {
    yes('R2', { newFrame: pivot.next.n, uptake: reply.n });
  }
}

function verification(rounds: readonly Round[], yes: QuestionEvidenceWriter) {
  const confirms = (round: Round, index: number) =>
    reasons(round.learner?.reply) && rounds[index + 1]?.verify;
  const isCheck = (round: Round) => open(round) && checkPrompt.test(round.ask?.prompt ?? '');
  const selected = rounds.findIndex((round, i) => isCheck(round) && confirms(round, i));
  const candidate = selected >= 0 ? rounds[selected] : rounds.find(isCheck);
  if (candidate) yes('V1', { prompt: candidate.n });
  if (selected >= 0 && candidate?.learner) {
    yes('V2', { prompt: candidate.n, response: candidate.learner.n });
  } else {
    const spontaneous = rounds.find(
      (round, i) =>
        (candidate === undefined || round.n >= candidate.n) &&
        open(round) &&
        confirms(round, i) &&
        spontaneousCheck.test(round.learner?.reply ?? ''),
    );
    if (spontaneous?.learner) yes('V2', { response: spontaneous.learner.n });
  }
}

/** M1 evidence proxies, not a semantic judgment of correctness or learner mastery. */
export function evaluateOfflineQuality(
  dialogue: PlayedDialogue,
  playedActions: readonly Action[],
  records: readonly LessonRecord[],
  transitions: readonly TeachingTransition[],
): OfflineQualityReport {
  const rounds = observeRounds(dialogue, playedActions, records, transitions);
  const exchanges = exchangesFor(rounds);
  const answers = emptyOfflineAnswers();
  const yes: QuestionEvidenceWriter = (id, evidence) => {
    if (Object.values(evidence).every((n) => dialogue.turns[n - 1]?.evidenceStepIds.length)) {
      answers[id] = { score: 1, evidence };
    }
  };
  misconception(exchanges, yes);
  support(exchanges, rounds[0], yes);
  agency(rounds, dialogue.turns.length, yes);
  struggle(exchanges, rounds[0], yes);
  representation(exchanges, yes);
  verification(rounds, yes);

  return {
    ruler: 'e1-binary-v3',
    mode: 'offline-rules',
    answers,
    scoring: scoreOfflineAnswers(answers),
  };
}
