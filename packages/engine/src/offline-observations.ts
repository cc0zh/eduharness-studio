import type { PlayedDialogue } from './projection.js';
import type { Action } from './protocol.js';
import type { LessonRecord } from './session-protocol.js';
import type { TeachingTransition } from './state.js';

type Input = Extract<LessonRecord, { kind: 'answer' | 'interrupt' }>;
type Ask = Extract<Action, { type: 'ask' }>;

export type Round = {
  n: number;
  ask?: Ask;
  learner?: { n: number; text: string; reply?: string; blocked: boolean };
  verify: boolean;
  hint: boolean;
  frame?: 'diagram' | 'analogy' | 'formula' | 'example';
  correction: boolean;
  reveal: boolean;
  fullSolution: boolean;
  takeover: boolean;
};

const fullSolution =
  /^(?:完整解|完整推导|完整解答|解题全过程|(?:here is the |the )?full solution)/iu;
const finalAnswer =
  /^(?:直接给出答案|最终答案(?:是|[：:])|答案(?:是|[：:])|(?:the )?(?:final )?answer is)/iu;
const takeover = /^(?:我替你(?:算|推出|完成)|我来直接(?:算|告诉)|直接替你|i.ll do it for you)/iu;
const analogy = /想象|打个比方|当作|类比|analog(?:y|ous)/iu;
const blocked =
  /卡在|没(?:看|听)?懂|不(?:理解|明白|会算|知道怎么)|还不懂|stuck|cannot (?:see|understand)/iu;
const scaffolding =
  /(?:先(?:试|画|圈|只|列|找)|留.{0,8}空|提示|只做第一步|hint|try (?:first|to))/iu;

const comparable = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, '');

function frameFor(actions: readonly Action[]): Round['frame'] {
  if (actions.some((a) => a.type === 'graph')) return 'diagram';
  const boards = actions.filter((a) => a.type === 'board');
  if (boards.some(({ content }) => analogy.test(content))) return 'analogy';
  if (boards.some(({ formula }) => formula)) return 'formula';
  if (boards.some(({ content }) => /\d|例子|场景/u.test(content))) return 'example';
  return undefined;
}

export function observeRounds(
  { turns, recordTurnNumbers }: PlayedDialogue,
  playedActions: readonly Action[],
  records: readonly LessonRecord[],
  transitions: readonly TeachingTransition[],
): Round[] {
  const byStep = new Map(playedActions.map((action) => [action.step_id, action]));
  const inputs = new Map<number, Input[]>();
  for (const [index, record] of records.entries()) {
    const n = recordTurnNumbers[index];
    if (!n || record.kind === 'subtitle') continue;
    const bucket = inputs.get(n) ?? [];
    bucket.push(record);
    inputs.set(n, bucket);
  }
  const verifySteps = new Set(
    transitions
      .filter(({ from, to }) => from === 'handoff' && to === 'verify')
      .map(({ step_id }) => step_id),
  );
  return turns.flatMap((turn, index) => {
    if (turn.role !== 'teacher') return [];
    const actions = turn.evidenceStepIds.flatMap((id) => byStep.get(id) ?? []);
    const ask = actions.find((action) => action.type === 'ask');
    const learner = turns[index + 1];
    const replies = learner?.role === 'learner' ? (inputs.get(learner.turnNumber) ?? []) : [];
    const answer = replies.find(
      (input) => input.kind === 'answer' && input.ask_step_id === ask?.step_id,
    );
    const question = replies.filter((input) => input.kind === 'interrupt').at(-1);
    const reply = comparable(answer?.text ?? '');
    // A turn may start with feedback on the previous task before introducing a new one.
    const afterFeedback =
      actions.map(({ step_id }) => verifySteps.has(step_id)).lastIndexOf(true) + 1;
    const instruction = actions.slice(afterFeedback);
    const texts = instruction.flatMap((a) =>
      a.type === 'speak' ? [a.text] : a.type === 'board' ? [a.title ?? '', a.content] : [],
    );
    const complete = texts.some((text) => fullSolution.test(text));
    return [
      {
        n: turn.turnNumber,
        ask,
        learner:
          learner?.role === 'learner'
            ? {
                n: learner.turnNumber,
                text: learner.text,
                reply: reply && !comparable(turn.text).includes(reply) ? answer?.text : undefined,
                blocked: question?.intent === 'explain' || blocked.test(learner.text),
              }
            : undefined,
        verify: afterFeedback > 0,
        hint: Boolean(ask?.hint || texts.some((text) => scaffolding.test(text))),
        frame: frameFor(instruction),
        correction: instruction.some(
          (a) => a.type === 'board' && /修正|误解|错因|辨析/u.test(a.title ?? ''),
        ),
        reveal: complete || texts.some((text) => finalAnswer.test(text)),
        fullSolution: complete,
        takeover: texts.some((text) => takeover.test(text)),
      } satisfies Round,
    ];
  });
}
