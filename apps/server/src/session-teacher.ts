import { projectPlayedDialogue } from '@eduharness-studio/engine';
import type {
  TeacherInput,
  TeacherPlan,
  TeacherPlanner,
  TeacherProgress,
  TeacherTurnContext,
} from '@eduharness-studio/engine/teacher';
import type { SessionCursor } from './session-cursor.js';
import type { StoredSession, sessionDatabase } from './session-db.js';

type Store = ReturnType<typeof sessionDatabase>;
type AcceptedPlan = Extract<TeacherPlan, { ok: true }>;
export type TeacherOperationLock = { scope: string; token: string };

export const teacherFailed = { error: 'teacher_turn_failed' } as const;

export function saveTeacherTrace(
  store: Store,
  id: string,
  plan: Pick<TeacherPlan, 'trace' | 'spans'>,
) {
  store.append(id, 'teacher-turn', plan.trace);
  for (const span of plan.spans) store.append(id, 'trace', span);
}

function matches(expected: StoredSession, current: StoredSession) {
  return (
    current.id === expected.id &&
    current.queue.generation === expected.queue.generation &&
    current.queue.retired === expected.queue.retired &&
    current.state === expected.state &&
    current.lastPlayed === expected.lastPlayed &&
    current.queue.askStep === expected.queue.askStep &&
    current.queue.teacher?.highWater === expected.queue.teacher?.highWater
  );
}

export function sameSession(
  expected: StoredSession | undefined,
  current: StoredSession | undefined,
) {
  return expected && current ? matches(expected, current) : expected === current;
}

export function teacherContext(
  cursor: SessionCursor,
  session: StoredSession,
  input: TeacherInput,
  progress: TeacherProgress,
): TeacherTurnContext {
  return {
    topic: session.queue.topic,
    keypoints: session.queue.script.keypoints,
    basis: session.queue.basis,
    state: session.state,
    played: cursor.played(session),
    input,
    progress,
    generation: session.queue.generation,
    seed: session.id,
  };
}

export function runSessionTeacher(store: Store, cursor: SessionCursor, planTurn: TeacherPlanner) {
  return async function applyTeacherTurn<T>(
    expected: StoredSession,
    context: TeacherTurnContext,
    commit: (current: StoredSession, plan: AcceptedPlan) => T,
    operation: TeacherOperationLock,
  ) {
    const records = store.readTransaction(() => {
      const current = cursor.owned(expected.id, expected.queue.generation);
      if ('error' in current) return current;
      if (!store.ownsTeacherLock(operation.scope, operation.token)) {
        return { error: 'stale_generation' } as const;
      }
      if (!matches(expected, current)) return { error: 'stale_generation' } as const;
      return store.records(expected.id);
    });
    if ('error' in records) return records;
    const plan = await planTurn(context, projectPlayedDialogue(context.played, records).turns);
    return store.transaction(() => {
      const current = cursor.owned(expected.id, expected.queue.generation);
      if ('error' in current) return current;
      if (!store.ownsTeacherLock(operation.scope, operation.token)) {
        return { error: 'stale_generation' } as const;
      }
      // A different connection or a new playback owner may have changed the snapshot during planning.
      if (!matches(expected, current)) return { error: 'stale_generation' } as const;
      saveTeacherTrace(store, current.id, plan);
      if (!plan.ok) {
        const reasons = plan.trace.guardrails.flatMap(({ reasons }) => reasons).slice(0, 8);
        return { ...teacherFailed, failure: plan.failure, reasons };
      }
      current.queue.script = {
        keypoints: plan.keypoints,
        actions: [...context.played, ...plan.actions],
      };
      current.queue.teacher = plan.progress;
      current.queue.askStep = null;
      return commit(current, plan);
    });
  };
}
