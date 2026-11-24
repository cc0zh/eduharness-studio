import { projectKeypointProgress, validateLessonScript } from './lesson-playback.js';
import type { Action, Keypoint } from './protocol.js';
import { stateAfterBeat, type TeachingState } from './state.js';
import type { LessonBasis, TeacherTurnOutput, TeacherTurnTrace } from './teacher-protocol.js';

export type TeacherInput =
  | { kind: 'opening' }
  | { kind: 'answer'; ask_step_id: number; text: string; choice?: boolean }
  | { kind: 'interrupt'; text: string };

export interface TeacherProgress {
  insertedCount: number;
  lowEffortStreak: number;
  highWater: number;
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

type Choice = NonNullable<Extract<Action, { type: 'ask'; mode: 'choice' }>['options']>;

export function shuffleAskOptions(options: Choice, seed: string): Choice {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  const shuffled = [...options];
  for (let i = shuffled.length - 1; i > 0; i--) {
    hash = Math.imul(hash, 1664525) + 1013904223;
    const j = (hash >>> 16) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const normalize = (text: string) => text.normalize('NFKC').trim().toLowerCase();
const normalizeReply = (text: string) =>
  normalize(text)
    .replace(/[。.！!？?]+$/, '')
    .trim();
const explicitNonAnswer =
  /^(?:(?:我)?(?:不知道|不清楚|不确定|拿不准|不会)(?:,\s*(?:请)?给(?:我)?(?:点|个)?提示)?|(?:请)?给(?:我)?(?:点|个)?提示|(?:i )?(?:do not know|don['’]t know)|(?:i am |i'm )?not sure)$/;

export function effortSignal(input: TeacherInput): 'skip' | 'low' | undefined {
  if (input.kind === 'opening') return undefined;
  const text = normalizeReply(input.text);
  if (
    /^(?:请)?(?:跳过(?:这(?:题|步|个要点))?|不做(?:这题)?了|先跳过|skip(?: this)?|pass)$/.test(text)
  ) {
    return 'skip';
  }
  if (input.kind === 'answer' && input.choice) return undefined;
  if (/^(?:1|继续(?:吧)?|直接讲(?:吧)?|嗯+|随便|continue|go on)$/.test(text)) return 'low';
  return undefined;
}

function answeredTeacherAsk({ input, state, played }: TeacherTurnContext) {
  const last = played.at(-1);
  return input.kind === 'answer' &&
    state === 'handoff' &&
    last?.type === 'ask' &&
    last.step_id === input.ask_step_id
    ? last
    : undefined;
}

export function teacherAnswerEvidence(context: TeacherTurnContext) {
  const ask = answeredTeacherAsk(context);
  const effort = effortSignal(context.input);
  const text = context.input.kind === 'answer' ? normalizeReply(context.input.text) : '';
  return {
    ask,
    effort,
    canAssessMastery:
      ask?.checkpoint === 'verify' && !effort && !!text && !explicitNonAnswer.test(text),
  };
}

export const teacherTextLimits = {
  board: 180,
  title: 48,
  formula: 140,
  speak: 140,
  prompt: 140,
  hint: 100,
  option: 56,
  highlight: 56,
  summary: 140,
} as const;

// Explicit answer disclosures can be blocked mechanically. The opening prompt also
// requires genuine scaffolding, which cannot be inferred from arbitrary prose alone.
const openingReveal =
  /(?:正确)?(?:答案|结果|选项)\s*(?:是|为|[:：])|\b(?:the |correct |final )?answer\s*(?:is\b|[:=])/i;

function textProblems(draft: TeacherTurnOutput['actions'][number], opening: boolean) {
  const limits = teacherTextLimits;
  const fields: { name: string; value: string | undefined; max: number }[] = [];
  if (draft.type === 'board') {
    fields.push(
      { name: 'content', value: draft.content, max: limits.board },
      { name: 'title', value: draft.title, max: limits.title },
      { name: 'formula', value: draft.formula, max: limits.formula },
    );
  } else if (draft.type === 'speak') {
    fields.push({ name: 'text', value: draft.text, max: limits.speak });
  } else if (draft.type === 'ask') {
    fields.push(
      { name: 'prompt', value: draft.prompt, max: limits.prompt },
      { name: 'hint', value: draft.hint, max: limits.hint },
      ...(draft.mode === 'choice'
        ? (draft.options ?? []).map(({ label }, i) => ({
            name: `options[${i}].label`,
            value: label,
            max: limits.option,
          }))
        : []),
    );
  } else if (draft.type === 'new_page') {
    fields.push({ name: 'title', value: draft.title, max: limits.title });
  } else if (draft.type === 'highlight') {
    fields.push({ name: 'target_text', value: draft.target_text, max: limits.highlight });
  } else if (draft.type === 'keypoint_complete') {
    fields.push({ name: 'summary', value: draft.summary, max: limits.summary });
  }
  return fields.flatMap(({ name, value, max }) => {
    if (value === undefined) return [];
    if (!value.trim() || value.length > max)
      return [`${name} must be nonblank and ≤ ${max} characters`];
    if (opening && openingReveal.test(value))
      return [`${name} explicitly reveals the answer in the opening`];
    return [];
  });
}

function actionProblems(context: TeacherTurnContext, output: TeacherTurnOutput): string[] {
  const cards = new Set(context.progress.truncatedCardIds);
  const board = new Set<string>();
  const pages = new Set(['opening']);
  for (const action of context.played) {
    if (action.type === 'new_page') pages.add(action.page_id);
    if (action.type === 'ask' || action.type === 'board' || action.type === 'graph')
      cards.add(action.card_id);
    if (action.type === 'board' || action.type === 'graph') board.add(action.card_id);
  }
  return output.actions.flatMap((draft, index) => {
    const errors = textProblems(draft, context.input.kind === 'opening');
    if (draft.type === 'new_page') {
      if (pages.has(draft.page_id)) errors.push('page_id already exists');
      pages.add(draft.page_id);
    }
    if (draft.type === 'highlight' && !board.has(draft.card_id)) {
      errors.push('highlight must target an acknowledged or earlier in-turn board card');
    }
    if (draft.type === 'board' || draft.type === 'ask') {
      if (cards.has(draft.card_id)) {
        errors.push(
          `${draft.type}.card_id must be new and distinct from all board and ask cards, including cards from a truncated beat`,
        );
      }
      cards.add(draft.card_id);
      if (draft.type === 'board') board.add(draft.card_id);
    }
    if (draft.type === 'ask' && draft.mode === 'choice') {
      const options = draft.options ?? [];
      if (
        options.length < 2 ||
        new Set(options.map(({ id }) => id)).size !== options.length ||
        new Set(options.map(({ label }) => normalize(label))).size !== options.length
      ) {
        errors.push('choice requires 2–4 options with distinct IDs and labels');
      }
    }
    return errors.map((error) => `actions[${index}]: ${error}`);
  });
}

export function guardTeacherTurn(context: TeacherTurnContext, output: TeacherTurnOutput) {
  const { input, progress, played } = context;
  const { diagnosis, insert_keypoint: inserted, actions: drafts } = output;
  const { keypoints, currentIndex } = projectKeypointProgress(context.keypoints, played);
  const current = keypoints[currentIndex];
  const reasons = actionProblems(context, output);
  const opening = input.kind === 'opening';
  const ask = drafts.at(-1);
  const outcomes = drafts.filter(
    (draft) => draft.type === 'keypoint_complete' || draft.type === 'keypoint_unverified',
  );
  const outcome = outcomes[0];
  const verification = drafts.findIndex((a) => a.type === 'speak' && a.checkpoint === 'verify');
  const lastPlayed = played.at(-1);
  const { ask: answeredAsk, effort: signal, canAssessMastery } = teacherAnswerEvidence(context);
  const lowEffort = diagnosis.status === 'low_effort';
  const skip = signal === 'skip' || (lowEffort && progress.lowEffortStreak > 0);

  if (current?.status !== 'active') reasons.push('no active keypoint remains');
  if (opening !== (diagnosis.status === 'opening'))
    reasons.push('opening diagnosis is only for the first turn');
  if (input.kind === 'answer' && !answeredAsk)
    reasons.push('answer must match the acknowledged, pending ask');
  if (diagnosis.status === 'mastered' && !canAssessMastery) {
    reasons.push('mastery requires a substantive answer to the acknowledged verify ask');
  }
  if (signal && !lowEffort)
    reasons.push('bare continuation or explicit skip must be diagnosed as low_effort');
  if (!diagnosis.summary.trim() || !diagnosis.strategy.trim())
    reasons.push('diagnosis needs a nonblank summary and strategy');
  if (inserted) {
    if (
      opening ||
      diagnosis.status !== 'missing_prereq' ||
      !current ||
      progress.insertedCount >= 2 ||
      keypoints.length >= 6 ||
      keypoints.some(({ id }) => id === inserted.id) ||
      !inserted.title.trim() ||
      !inserted.objective.trim()
    ) {
      reasons.push(
        opening
          ? 'omit insert_keypoint on the opening turn'
          : 'insert_keypoint must be a new prerequisite before the active point, with at most two insertions and six total points',
      );
    } else {
      keypoints[currentIndex] = { ...current, status: 'pending' };
      keypoints.splice(currentIndex, 0, { ...inserted, status: 'active' });
    }
  }

  if (outcomes.length > 1 || (outcome && outcome.keypoint_id !== current?.id))
    reasons.push('resolve at most the active keypoint');
  if (outcome?.type === 'keypoint_complete') {
    if (
      diagnosis.status !== 'mastered' ||
      !canAssessMastery ||
      verification < 0 ||
      drafts[verification + 1] !== outcome
    ) {
      reasons.push(
        'keypoint_complete requires mastered and an acknowledged verify ask → matching answer → speak(checkpoint=verify) immediately before completion',
      );
    }
  } else if (verification >= 0) {
    reasons.push(
      'speak(checkpoint=verify) belongs only to an answered transfer check followed by keypoint_complete',
    );
  }
  if (skip !== (outcome?.type === 'keypoint_unverified')) {
    reasons.push(
      skip
        ? 'advance the active point with keypoint_unverified'
        : 'keypoint_unverified requires explicit skip or repeated low effort',
    );
  }
  if (
    lowEffort &&
    !skip &&
    (ask?.type !== 'ask' || ask.mode !== 'choice' || ask.options?.length !== 2 || ask.checkpoint)
  ) {
    reasons.push(
      'first low_effort turn must end with an intuitive two-option ask, without a verify checkpoint',
    );
  }
  const finishing = Boolean(outcome && currentIndex === keypoints.length - 1);
  if (finishing ? ask !== outcome : ask?.type !== 'ask') {
    reasons.push(
      finishing
        ? 'finish the lesson with its last keypoint outcome'
        : 'a nonfinal turn must end at ask',
    );
  }
  if (drafts.slice(0, -1).some(({ type }) => type === 'ask'))
    reasons.push('only the last beat can be ask');
  if (ask?.type === 'ask' && ask.checkpoint === 'verify') {
    if (
      !answeredAsk ||
      signal ||
      outcome ||
      inserted ||
      lowEffort ||
      played.some((a) => a.type === 'ask' && normalize(a.prompt) === normalize(ask.prompt))
    ) {
      reasons.push(
        'verify ask must be a new near-transfer question for the current point after a substantive answer',
      );
    }
  }

  const highWater = Math.max(progress.highWater, lastPlayed?.step_id ?? 0);
  const initialState: TeachingState =
    outcome?.type === 'keypoint_complete' ? 'handoff' : 'diagnose';
  const actions = drafts.map((draft, index): Action => {
    const step_id = highWater + index + 1;
    return draft.type === 'ask' && draft.mode === 'choice' && draft.options
      ? {
          ...draft,
          options: shuffleAskOptions(draft.options, `${context.seed}:${step_id}`),
          step_id,
        }
      : { ...draft, step_id };
  });
  if (!Number.isSafeInteger(highWater + actions.length))
    reasons.push('step_id exceeds the safe monotonic range');
  let state: TeachingState = initialState;
  for (const [index, action] of actions.entries()) {
    const next = stateAfterBeat(state, action, false, index === actions.length - 1);
    if (!next) {
      reasons.push(`actions[${index}]: ${action.type} cannot play in state ${state}`);
      break;
    }
    state = next;
  }
  if (!reasons.length && !validateLessonScript({ keypoints, actions: [...played, ...actions] })) {
    reasons.push('validated actions and keypoints must form a valid playback script');
  }
  if (reasons.length) return { ok: false as const, reasons };

  const trace: Pick<
    TeacherTurnTrace,
    'diagnosis' | 'inserted' | 'unverified' | 'unverifiedStepId'
  > = { diagnosis };
  if (inserted) trace.inserted = { id: inserted.id, title: inserted.title, before: current.id };
  if (outcome?.type === 'keypoint_unverified') {
    trace.unverified = outcome.keypoint_id;
    trace.unverifiedStepId = actions.find(
      (action) =>
        action.type === 'keypoint_unverified' && action.keypoint_id === outcome.keypoint_id,
    )?.step_id;
  }
  return {
    ok: true as const,
    actions,
    keypoints,
    initialState,
    trace,
    progress: {
      ...progress,
      highWater: highWater + actions.length,
      insertedCount: progress.insertedCount + Number(Boolean(inserted)),
      lowEffortStreak: lowEffort ? Math.min(progress.lowEffortStreak + 1, 2) : 0,
    },
  };
}
