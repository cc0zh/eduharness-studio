import { randomUUID } from 'node:crypto';
import {
  type LessonBasis,
  type LessonScript,
  type SessionSnapshot,
  type TeachingTransition,
  validateLessonScript,
} from '@eduharness-studio/engine';
import type { LessonOpeningEvidence } from '@eduharness-studio/engine/course';
import {
  type TeacherPlan,
  type TeacherPlanner,
  type TeacherProgress,
  teacherGraphSpan,
} from '@eduharness-studio/engine/teacher';
import type { SessionCursor } from './session-cursor.js';
import type { StoredSession, sessionDatabase } from './session-db.js';
import type { createSessionLocks } from './session-lock.js';
import {
  sameSession,
  saveTeacherTrace,
  type TeacherOperationLock,
  teacherFailed,
} from './session-teacher.js';

type StartOptions = {
  courseId: string;
  lessonId: string;
  topic: string;
  buildScript: () => LessonScript;
  restart: boolean;
  live: boolean;
  preplanned?: boolean;
  basis?: LessonBasis;
  openingEvidence?: LessonOpeningEvidence;
};

type Started = { created: boolean; snapshot: SessionSnapshot };
type FailedTeacherPlan = Extract<TeacherPlan, { ok: false }>;
type TeacherTurnError = {
  error: 'teacher_turn_failed';
  failure?: FailedTeacherPlan['failure'];
  reasons?: string[];
  trace?: FailedTeacherPlan['trace'];
  spans?: FailedTeacherPlan['spans'];
};
type StartResult =
  | Started
  | TeacherTurnError
  | { error: 'session_not_found' | 'stale_generation' | 'teacher_turn_busy' | 'session_retired' };

type Store = ReturnType<typeof sessionDatabase>;
type OfflineTrace = (session: StoredSession, name: string, durationMs: number) => void;

export function createSessionOpening(
  store: Store,
  cursor: SessionCursor,
  planTurn: TeacherPlanner,
  traceOffline: OfflineTrace,
  locks: ReturnType<typeof createSessionLocks>,
) {
  async function startNew(
    options: StartOptions,
    previous: StoredSession | undefined,
    operation: TeacherOperationLock,
    sessionOperation?: TeacherOperationLock,
  ) {
    const { courseId, lessonId, topic, buildScript, live, preplanned, basis } = options;
    const id = randomUUID();
    const began = performance.now();
    let script = buildScript();
    const offlineDuration = performance.now() - began;
    let plan: TeacherPlan | undefined;
    if (live && !preplanned) {
      plan = await planTurn(
        {
          topic,
          keypoints: script.keypoints,
          basis,
          state: 'intake',
          played: [],
          input: { kind: 'opening' },
          generation: 1,
          seed: id,
          progress: { highWater: 0, insertedCount: 0, lowEffortStreak: 0, truncatedCardIds: [] },
        },
        [],
      );
      if (!plan.ok) {
        const failedPlan = plan;
        if (!previous) {
          return {
            ...teacherFailed,
            failure: failedPlan.failure,
            reasons: failedPlan.trace.guardrails.flatMap(({ reasons }) => reasons).slice(0, 8),
            trace: failedPlan.trace,
            spans: failedPlan.spans,
          };
        }
        return store.transaction(() => {
          const current = store.latest(courseId, lessonId);
          if (
            !current ||
            !store.ownsTeacherLock(operation.scope, operation.token) ||
            (sessionOperation &&
              !store.ownsTeacherLock(sessionOperation.scope, sessionOperation.token)) ||
            !sameSession(previous, current)
          ) {
            return { error: 'stale_generation' } as const;
          }
          saveTeacherTrace(store, current.id, failedPlan);
          return {
            ...teacherFailed,
            failure: failedPlan.failure,
            reasons: failedPlan.trace.guardrails.flatMap(({ reasons }) => reasons).slice(0, 8),
          };
        });
      }
      script = { keypoints: plan.keypoints, actions: plan.actions };
    }
    if (!validateLessonScript(script)) throw new Error('Invalid lesson script');
    const teacherProgress: TeacherProgress | undefined = plan?.ok
      ? plan.progress
      : live && preplanned
        ? {
            highWater: script.actions.at(-1)?.step_id ?? 0,
            insertedCount: 0,
            lowEffortStreak: 0,
            truncatedCardIds: [],
          }
        : undefined;
    return store.transaction(() => {
      const current = store.latest(courseId, lessonId);
      if (
        !store.ownsTeacherLock(operation.scope, operation.token) ||
        (sessionOperation &&
          !store.ownsTeacherLock(sessionOperation.scope, sessionOperation.token)) ||
        !sameSession(previous, current)
      ) {
        return { error: 'stale_generation' } as const;
      }
      if (current) {
        cursor.supersede(current);
        current.queue.retired = true;
        store.save(current);
      }
      const session = store.insert(id, courseId, lessonId, topic, script, {
        teacher: teacherProgress,
        basis,
      });
      store.append(id, 'state', {
        from: null,
        to: 'intake',
        generation: 0,
        step_id: 0,
      } satisfies TeachingTransition);
      const snapshot = cursor.claim(session);
      if (plan) saveTeacherTrace(store, id, plan);
      else if (live && options.openingEvidence) {
        const { diagnosis, durationMs, guardrails, graph } = options.openingEvidence;
        const anchor = { generation: snapshot.generation, step_id: 0 };
        saveTeacherTrace(store, id, {
          trace: { ...anchor, trigger: 'opening', diagnosis, guardrails, outcome: 'accepted' },
          spans: [
            { ...anchor, kind: 'model', name: 'lesson_opening', durationMs },
            ...(graph ? [teacherGraphSpan(anchor.generation, graph)] : []),
          ],
        });
      } else if (!preplanned) traceOffline(session, 'lesson_script', offlineDuration);
      return { created: true, snapshot };
    });
  }

  function start(options: StartOptions) {
    const { courseId, lessonId, restart } = options;
    return locks.run<StartResult>(`lesson:${courseId}/${lessonId}`, (operation) => {
      const previous = store.latest(courseId, lessonId);
      if (!previous && !restart && store.hasUnversioned(courseId, lessonId)) {
        return { error: 'session_retired' } as const;
      }
      if (previous) {
        return locks.run(
          `session:${previous.id}:${previous.queue.generation}`,
          (sessionOperation) => {
            if (!restart) {
              return store.transaction(() => {
                const current = store.latest(courseId, lessonId);
                return store.ownsTeacherLock(operation.scope, operation.token) &&
                  store.ownsTeacherLock(sessionOperation.scope, sessionOperation.token) &&
                  current?.id === previous.id
                  ? { created: false, snapshot: cursor.claim(current) }
                  : { error: 'stale_generation' as const };
              });
            }
            return startNew(options, previous, operation, sessionOperation);
          },
        );
      }
      return startNew(options, previous, operation);
    });
  }

  return { start };
}
