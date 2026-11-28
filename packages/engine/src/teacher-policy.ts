import { liveLessonKeypointCount, projectKeypointProgress } from './lesson-playback.js';
import { type TeacherTurnContext, teacherAnswerEvidence } from './teacher-context.js';
import { teacherPacing } from './teacher-pacing.js';
import { defineTurnPolicy, type TurnPolicy } from './teacher-semantics.js';

const common = {
  insertKeypoint: false,
  resolution: false,
  transferAsk: false,
  diagram: true,
  nextAsk: 'required',
} as const;
const opening = {
  ...common,
  phase: 'opening',
  diagnoses: ['opening'],
} as const;
export const openingTurnPolicy = defineTurnPolicy(opening, teacherPacing(0, []));

const normalDiagnoses = [
  'misconception',
  'missing_prereq',
  'answer_seeking',
  'clarifying',
] as const;

export function teacherTurnPolicy(context: TeacherTurnContext): TurnPolicy {
  const { keypoints, currentIndex } = projectKeypointProgress(context.keypoints, context.played);
  const pacing = teacherPacing(context.played.length, keypoints);
  if (pacing.close) {
    return defineTurnPolicy(
      {
        ...common,
        phase: 'budget-close',
        diagnoses: ['clarifying'],
        diagram: false,
        nextAsk: 'omit',
      },
      pacing,
    );
  }
  if (context.input.kind === 'opening') return defineTurnPolicy(opening, pacing);

  const active = keypoints[currentIndex]?.status === 'active';
  const last = currentIndex === keypoints.length - 1;
  if (!active && keypoints.length && context.input.kind === 'interrupt') {
    return defineTurnPolicy(
      { ...common, phase: 'closing', diagnoses: ['clarifying'], nextAsk: 'omit' },
      pacing,
    );
  }
  const { ask, effort, substantive } = teacherAnswerEvidence(context);
  if (effort) {
    const unverified = effort === 'skip' || context.progress.lowEffortStreak > 0;
    return defineTurnPolicy(
      {
        ...common,
        phase: unverified ? 'unverified' : 'first-low-effort',
        diagnoses: ['low_effort'],
        diagram: false,
        nextAsk: unverified && last ? 'omit' : 'required',
      },
      pacing,
    );
  }

  const canAssess = active && substantive && ask?.checkpoint === 'verify';
  return defineTurnPolicy(
    {
      phase:
        context.input.kind === 'interrupt'
          ? 'interrupt'
          : ask?.checkpoint === 'verify'
            ? 'verify'
            : 'answer',
      diagnoses: canAssess ? [...normalDiagnoses, 'mastered'] : normalDiagnoses,
      insertKeypoint:
        active &&
        !!ask &&
        context.progress.insertedCount < 2 &&
        keypoints.length < liveLessonKeypointCount.maxItems,
      resolution: canAssess,
      transferAsk: active && !!ask && substantive && ask.checkpoint !== 'verify',
      diagram: true,
      nextAsk: canAssess && last ? 'conditional' : 'required',
    },
    pacing,
  );
}
