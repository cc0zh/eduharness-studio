import { Value } from '@sinclair/typebox/value';
import {
  type ActionDraft,
  projectKeypointProgress,
  stateAfterScriptBeat,
  validateLessonScript,
} from './lesson-playback.js';
import type { Action, Keypoint } from './protocol.js';
import type { TeachingState } from './state.js';
import {
  hasSensitiveFields,
  schemaReasons,
  sensitiveOutputReason,
} from './structured-model-output.js';
import { bindTeacherNumbers } from './teacher-bindings.js';
import { oneLine, type TeacherTurnContext, teacherAnswerEvidence } from './teacher-context.js';
import { guardTeacherTurn } from './teacher-guardrails.js';
import {
  isOpenKeypoint,
  minTeachingTurnBeats,
  type TeacherPacing,
  teacherBeatBudgetReason,
} from './teacher-pacing.js';
import { teacherTurnPolicy } from './teacher-policy.js';
import type { TeacherTurnTrace } from './teacher-protocol.js';
import type { TeacherGraphDraft } from './teacher-semantics.js';
import type { TeacherCalculation } from './teacher-tools.js';

function boardPlacement(played: readonly Action[]) {
  let column = 0;
  let resolvedOnPage = false;
  for (const beat of played) {
    if (beat.type === 'new_page') {
      column = 0;
      resolvedOnPage = false;
    } else if (beat.type === 'board' || beat.type === 'graph' || beat.type === 'new_column') {
      column = Math.max(column, beat.column);
    } else if (beat.type === 'keypoint_complete' || beat.type === 'keypoint_unverified') {
      resolvedOnPage = true;
    }
  }
  return { column, resolvedOnPage };
}

function idAllocator(context: TeacherTurnContext) {
  const used = new Set(['opening', ...context.progress.truncatedCardIds]);
  for (const beat of context.played) {
    if (beat.type === 'new_page') used.add(beat.page_id);
    if ('card_id' in beat) used.add(beat.card_id);
  }
  return (step: number, kind: 'page' | 'panel' | 'ask') => {
    const base = `s${step}-${kind}`;
    let id = base;
    let suffix = 1;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id);
    return id;
  };
}

function shuffledOptions(labels: readonly string[], seed: string) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  const options = labels.map((label, index) => ({ id: `option-${index + 1}`, label }));
  for (let i = options.length - 1; i > 0; i--) {
    hash = Math.imul(hash, 1664525) + 1013904223;
    const j = (hash >>> 16) % (i + 1);
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

const reject = (reasons: string[]) => ({ ok: false as const, reasons });

function scheduleBeats(context: TeacherTurnContext) {
  const actions: Action[] = [];
  let step = Math.max(context.progress.highWater, context.played.at(-1)?.step_id ?? 0);
  const allocate = idAllocator(context);
  return {
    actions,
    get nextStep() {
      return step + 1;
    },
    allocate: (kind: 'page' | 'panel' | 'ask') => allocate(step + 1, kind),
    emit: (draft: ActionDraft) => {
      actions.push({ ...draft, step_id: ++step });
      return step;
    },
  };
}

type TurnTrace = Pick<
  TeacherTurnTrace,
  'diagnosis' | 'inserted' | 'unverified' | 'unverifiedStepId'
>;
type Illustration = { index: number; request: TeacherGraphDraft & { title: string } };
type TurnDraft = {
  actions: Action[];
  keypoints: Keypoint[];
  initialState: TeachingState;
  trace: TurnTrace;
  illustration?: Illustration;
};

function validateTurn(
  context: TeacherTurnContext,
  draft: TurnDraft,
  reserveClose: boolean,
  lowEffortStreak: number,
) {
  const { actions, keypoints, initialState, trace } = draft;
  const { progress, played } = context;
  const overBudget = teacherBeatBudgetReason(
    played.length,
    actions,
    reserveClose ? keypoints : undefined,
  );
  if (overBudget) return reject([overBudget]);

  const script = { keypoints, actions: [...played, ...actions] };
  const highWater = actions.at(-1)?.step_id;
  if (
    highWater === undefined ||
    !Number.isSafeInteger(highWater) ||
    !validateLessonScript(script)
  ) {
    return reject(['compiled scene did not form a valid playback script']);
  }
  let state = initialState;
  for (const action of actions) {
    const next = stateAfterScriptBeat(state, action, false, script);
    if (!next) return reject(['compiled scene could not play in the teaching state']);
    state = next;
  }
  return {
    ok: true as const,
    ...draft,
    progress: {
      ...progress,
      highWater,
      insertedCount: progress.insertedCount + Number(Boolean(trace.inserted)),
      lowEffortStreak,
    },
  };
}

/** Deterministic terminal turn; only acknowledged point outcomes survive an interruption. */
function compileTeacherBudgetClose(context: TeacherTurnContext, pacing: TeacherPacing) {
  if (context.input.kind === 'answer' && !teacherAnswerEvidence(context).ask) {
    return reject(['answer must match the acknowledged, pending ask']);
  }
  const { keypoints } = projectKeypointProgress(context.keypoints, context.played);
  const initialState = context.state === 'scaffold' ? 'scaffold' : 'diagnose';
  let scaffolded = initialState === 'scaffold';
  // Reusing the first cue frees one beat. Don't let that undo the close when cut after its outcome.
  let needsCue = !scaffolded || pacing.teachingBeats + 1 >= minTeachingTurnBeats;
  const { actions, allocate, emit } = scheduleBeats(context);
  const trace: TurnTrace = {
    diagnosis: {
      status: 'clarifying',
      summary: '本课拍数预算已用到收尾。',
      strategy: '仅保留已验证结果，简短回顾。',
    },
  };
  for (const point of keypoints.filter(isOpenKeypoint)) {
    if (needsCue)
      emit({ type: 'speak', text: `「${oneLine(point.title).slice(0, 48)}」先记为未验证。` });
    const step = emit({ type: 'keypoint_unverified', keypoint_id: point.id });
    trace.unverified ??= point.id;
    trace.unverifiedStepId ??= step;
    scaffolded = false;
    needsCue = true;
  }

  let { column } = boardPlacement(context.played);
  if (!scaffolded || column >= 2) {
    emit({ type: 'new_page', page_id: allocate('page'), title: '课堂回顾' });
    column = 0;
  }
  const verified = keypoints.filter(({ status }) => status === 'completed').length;
  const unverified = keypoints.length - verified;
  const nextReview = keypoints.find(({ status }) => status !== 'completed');
  emit({
    type: 'board',
    column: column + 1,
    card_id: allocate('panel'),
    title: '课堂回顾',
    content: nextReview
      ? `已验证 ${verified} 个要点；另有 ${unverified} 个未验证，不算过关。可从「${oneLine(nextReview.title).slice(0, 48)}」再练一道题。`
      : `已验证 ${verified} 个要点。保留已确认的结论，这节课先到这里。`,
  });
  return validateTurn(context, { actions, keypoints, initialState, trace }, false, 0);
}

/** Compile normalized teaching semantics without IO, clock reads or random state. */
export function compileTeacherTurn(
  context: TeacherTurnContext,
  draft?: unknown,
  calculations: readonly TeacherCalculation[] = [],
) {
  if (hasSensitiveFields(draft)) return reject([sensitiveOutputReason]);
  const policy = teacherTurnPolicy(context);
  if (policy.phase === 'budget-close') return compileTeacherBudgetClose(context, policy.pacing);
  const { schema } = policy;
  if (!Value.Check(schema, draft)) return reject(schemaReasons(schema, draft));
  const bound = bindTeacherNumbers(draft);
  if (!bound.ok) return bound;
  const { scene } = bound;
  const checked = guardTeacherTurn(context, scene, policy, calculations);
  if (!checked.ok) return checked;

  const { played } = context;
  const { current, keypoints, teachingPoint, trace } = checked;
  const schedule = scheduleBeats(context);
  const { actions, allocate, emit } = schedule;
  const { column: playedColumn, resolvedOnPage } = boardPlacement(played);
  let column = playedColumn;
  // The recap starts a new section, so even one bare panel can enter scaffold before closing.
  const recap = checked.finishing && !checked.unverified;
  let turnPage = recap || checked.changedPoint || resolvedOnPage;
  let illustration: Illustration | undefined;
  const markUnverified = () => {
    trace.unverified = current.id;
    trace.unverifiedStepId = emit({ type: 'keypoint_unverified', keypoint_id: current.id });
  };

  if (scene.resolution) {
    emit({ type: 'speak', checkpoint: 'verify', text: scene.resolution.text });
    emit({
      type: 'keypoint_complete',
      keypoint_id: current.id,
      summary: oneLine(scene.resolution.conclusion),
    });
  } else if (checked.unverified) {
    emit({ type: 'speak', text: '这个要点先记为未验证，不算过关。' });
    if (!checked.finishing) markUnverified();
  }

  for (const panel of scene.panels) {
    if (turnPage || column >= 2) {
      emit({
        type: 'new_page',
        page_id: allocate('page'),
        title: recap ? '课堂回顾' : teachingPoint.title,
      });
      column = 0;
      turnPage = false;
    }
    const card_id = allocate('panel');
    const mark =
      panel.highlight && panel.content.includes(panel.highlight) ? panel.highlight : undefined;
    // An image replaces the board body and cannot display a mark or the quoted example.
    if (panel.diagram && !mark && !panel.quoted_error) {
      illustration = { index: actions.length, request: { ...panel.diagram, title: panel.title } };
    }
    emit({
      type: 'board',
      column: ++column,
      card_id,
      title: panel.title,
      content: panel.quoted_error
        ? `${panel.content}\n\n**学生错算 / 反例（仅作对照）**\n\n${panel.quoted_error}`
        : panel.content,
      depth: teachingPoint.depth,
      ...(panel.formula === undefined ? {} : { formula: panel.formula }),
    });
    if (mark) {
      emit({ type: 'highlight', card_id, target_text: mark, style: 'highlight' });
    }
    if (panel.voiceover) emit({ type: 'speak', text: panel.voiceover });
  }

  if (checked.unverified && checked.finishing) markUnverified();
  if (scene.next_ask) {
    const { prompt, hint, options, transfer } = scene.next_ask;
    const common = {
      type: 'ask' as const,
      card_id: allocate('ask'),
      prompt,
      ...(hint === undefined ? {} : { hint }),
      ...(transfer ? { checkpoint: 'verify' as const } : {}),
    };
    emit(
      options
        ? {
            ...common,
            mode: 'choice',
            options: shuffledOptions(options, `${context.seed}:${schedule.nextStep}`),
          }
        : { ...common, mode: 'open' },
    );
  }

  const initialState: TeachingState = scene.resolution ? 'handoff' : 'diagnose';
  const lowEffortStreak =
    policy.phase === 'first-low-effort' || checked.unverified
      ? Math.min(context.progress.lowEffortStreak + 1, 2)
      : 0;
  return validateTurn(
    context,
    { actions, illustration, keypoints, initialState, trace },
    true,
    lowEffortStreak,
  );
}

export type CompiledTeacherTurn = Extract<ReturnType<typeof compileTeacherTurn>, { ok: true }>;
