import type { Action, Keypoint } from './protocol.js';
import type { TeachingState } from './state.js';
import type { LessonBasis } from './teacher-protocol.js';

export type TeacherInput =
  | { kind: 'opening' }
  | { kind: 'answer'; ask_step_id: number; text: string; choice?: boolean }
  | { kind: 'interrupt'; text: string };

export interface TeacherProgress {
  insertedCount: number;
  lowEffortStreak: number;
  highWater: number;
  // Keep the stored property name: this reserves retired card AND page IDs.
  truncatedCardIds: string[];
}

export interface TeacherTurnContext {
  topic: string;
  keypoints: readonly Keypoint[];
  state: TeachingState;
  basis?: LessonBasis;
  played: readonly Action[];
  input: TeacherInput;
  progress: TeacherProgress;
  generation: number;
  seed: string;
}

export const normalizeReply = (text: string) =>
  text
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s*[。.！!？?]+\s*$/, '');

const noAnswer =
  /^(?:(?:我)?(?:不知道|不清楚|不确定|拿不准|没想好|不懂|不会(?:做(?:这(?:道)?题)?)?)|(?:i )?(?:do not know|don['’]t know)|(?:i am |i'm )?not sure)$/;
const answerRequest =
  /^(?:(?:请|能不能|能|可以)?给(?:我)?(?:点|个|一点|一个)?提示(?:吧|吗)?|(?:老师\s*)?(?:请|能不能|能|可以)?(?:直接)?(?:告诉我|给我|说出|说|讲)(?:一下)?(?:正确)?答案(?:吧|吗)?|(?:求|要)(?:正确)?答案|(?:please |just )?tell me the answer)$/;
const acknowledgement =
  /^(?:老师|好(?:的|吧)?|ok(?:ay)?|行|可以|收到|(?:我)?(?:知道|懂|明白|理解)了|是的|对的|没错)$/;
const perfunctory = /^(?:继续(?:吧)?|直接讲(?:吧)?|嗯+|随便|continue|go on)$/;

function noSubstantiveAnswer(text: string, chosen: boolean) {
  const clauses = text
    .split(/[,.、;:。!?]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  // Acknowledgements like “可以” can be valid if they are the label of a real choice.
  return clauses.every(
    (clause) =>
      noAnswer.test(clause) ||
      answerRequest.test(clause) ||
      perfunctory.test(clause) ||
      (!chosen && (clause === '1' || acknowledgement.test(clause))),
  );
}

export function effortSignal(input: TeacherInput): 'skip' | 'low' | undefined {
  if (input.kind === 'opening') return undefined;
  const text = normalizeReply(input.text);
  if (
    /^(?:请)?(?:跳过(?:这(?:题|步|个要点))?|不做(?:这题)?了|先跳过|skip(?: this)?|pass)$/.test(text)
  ) {
    return 'skip';
  }
  if (input.kind === 'answer' && input.choice) return undefined;
  if (text === '1' || perfunctory.test(text)) return 'low';
  return undefined;
}

export function teacherAnswerEvidence({ input, state, played }: TeacherTurnContext) {
  const last = played.at(-1);
  const ask =
    input.kind === 'answer' &&
    state === 'handoff' &&
    last?.type === 'ask' &&
    last.step_id === input.ask_step_id
      ? last
      : undefined;
  const effort = effortSignal(input);
  const text = input.kind === 'answer' ? normalizeReply(input.text) : '';
  const substantive =
    /[\p{L}\p{N}]/u.test(text) &&
    !effort &&
    !noSubstantiveAnswer(
      text,
      Boolean(input.kind === 'answer' && input.choice && ask?.mode === 'choice'),
    );
  return { ask, effort, substantive };
}

export const oneLine = (text: string) => text.trim().replace(/\s+/g, ' ');

// A played completion already stores the conclusion. No second persisted authority is needed.
export function playedConclusions(played: readonly Action[]): string[] {
  const seen = new Set<string>();
  const conclusions: string[] = [];
  for (let i = played.length - 1; i >= 0 && conclusions.length < 4; i--) {
    const beat = played[i];
    if (beat.type !== 'keypoint_complete' || seen.has(beat.keypoint_id)) continue;
    seen.add(beat.keypoint_id);
    const summary = beat.summary && oneLine(beat.summary).slice(0, 140);
    if (summary) conclusions.push(summary);
  }
  return conclusions.reverse();
}
