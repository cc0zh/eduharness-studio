import { projectKeypointProgress } from './lesson-playback.js';
import {
  normalizeReply,
  type TeacherTurnContext,
  teacherAnswerEvidence,
} from './teacher-context.js';
import type { TeacherTurnTrace } from './teacher-protocol.js';
import type { TeacherTurnOutput, TurnPolicy } from './teacher-semantics.js';

const leadsWithAnswer =
  /(?:(?:正确|最终)的?(?:答案|选项|结果)|答案|选项)\s*(?:是|为|[:=])|\b(?:the |correct |final )?answer\s*(?:is\b|[:=])/giu;
const identifiesAnswer =
  /(?:是|为)\s*(?:(?:正确|最终)的?(?:答案|选项|结果)|答案)|\b(?:is|was)\s+(?:the\s+)?(?:correct\s+|final\s+)?answer\b/giu;
const questionWord =
  /(?:什么|哪[个一项种里些边]|多少|如何|怎样|是否|是不是)|\b(?:what|which|who|how|why|do you)\b/i;
const startsWithQuestion = new RegExp(`^(?:${questionWord.source})`, 'i');
const hasValue = /[\p{L}\p{N}]/u;

export function revealsOpeningAnswer(text: string): boolean {
  const clauses = text
    .normalize('NFKC')
    .replace(/[*_`]/g, '')
    .split(/[，,。.!?;]+/);
  for (const clause of clauses) {
    if (/[吗么]\s*$/.test(clause)) continue;
    for (const match of clause.matchAll(leadsWithAnswer)) {
      const before = clause.slice(0, match.index);
      const value = clause.slice((match.index ?? 0) + match[0].length).replace(/^[\s"'「“:]+/, '');
      if (hasValue.test(value) && !questionWord.test(before) && !startsWithQuestion.test(value))
        return true;
    }
    for (const match of clause.matchAll(identifiesAnswer)) {
      const value = clause.slice(0, match.index);
      if (hasValue.test(value) && !questionWord.test(value)) return true;
    }
  }
  return false;
}

function revealsOpening(scene: TeacherTurnOutput): boolean {
  const { panels, next_ask: ask } = scene;
  return [
    ...panels.flatMap(({ title, content, formula, highlight, voiceover, diagram }) => [
      title,
      content,
      formula,
      highlight,
      voiceover,
      diagram?.description,
    ]),
    ask?.prompt,
    ask?.hint,
    ...(ask?.options ?? []),
  ].some((text) => text !== undefined && revealsOpeningAnswer(text));
}

// These are pedagogical checks, not repairs to syntax or to an emitted action queue.
export function guardTeacherTurn(
  context: TeacherTurnContext,
  scene: TeacherTurnOutput,
  policy: TurnPolicy,
) {
  const { keypoints, currentIndex } = projectKeypointProgress(context.keypoints, context.played);
  const current = keypoints[currentIndex];
  const following = keypoints[currentIndex + 1];
  const { diagnosis, resolution, panels, insert_keypoint: inserted, next_ask: ask } = scene;
  const closing = policy.phase === 'closing';
  const mastered = diagnosis.status === 'mastered';
  const unverified = policy.phase === 'unverified';
  const finishing = closing || ((mastered || unverified) && !following);
  const reasons: string[] = [];

  if (!closing && current?.status !== 'active') reasons.push('no active keypoint remains');
  if (context.input.kind === 'answer' && !teacherAnswerEvidence(context).ask) {
    reasons.push('answer must match the acknowledged, pending ask');
  }
  if (mastered !== Boolean(resolution)) {
    reasons.push('a passed transfer check and its feedback must be submitted together');
  }
  if (
    inserted &&
    (diagnosis.status !== 'missing_prereq' || keypoints.some(({ id }) => id === inserted.id))
  ) {
    reasons.push('a prerequisite must have a new ID and a missing-prerequisite diagnosis');
  }
  if (panels.filter(({ diagram }) => diagram).length > 1) {
    reasons.push('only one illustration may be requested in a scene');
  }
  if (finishing === Boolean(ask)) {
    reasons.push(
      finishing ? 'close the lesson without handing off again' : 'hand off with one question',
    );
  }
  if (ask?.options && new Set(ask.options.map(normalizeReply)).size !== ask.options.length) {
    reasons.push('choice labels must be distinct');
  }
  if (
    ask?.transfer &&
    (inserted ||
      context.played.some(
        (action) =>
          action.type === 'ask' && normalizeReply(action.prompt) === normalizeReply(ask.prompt),
      ))
  ) {
    reasons.push('transfer requires a new question for the same active point');
  }
  if (policy.phase === 'opening' && revealsOpening(scene)) {
    reasons.push('the scene explicitly reveals the answer in the opening');
  }
  if (reasons.length) return { ok: false as const, reasons };

  const trace: Pick<
    TeacherTurnTrace,
    'diagnosis' | 'inserted' | 'unverified' | 'unverifiedStepId'
  > = { diagnosis };
  if (inserted) {
    keypoints[currentIndex] = { ...current, status: 'pending' };
    keypoints.splice(currentIndex, 0, { ...inserted, status: 'active' });
    trace.inserted = { id: inserted.id, title: inserted.title, before: current.id };
  }
  return {
    ok: true as const,
    keypoints,
    current,
    following,
    trace,
    finishing,
    unverified,
    changedPoint: Boolean(inserted || (following && (mastered || unverified))),
    teachingPoint: inserted ?? ((mastered || unverified) && following ? following : current),
  };
}
