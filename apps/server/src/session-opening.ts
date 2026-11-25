import { randomUUID } from 'node:crypto';
import {
  type SessionSnapshot,
  type TeachingTransition,
  validateLessonScript,
} from '@eduharness-studio/engine';
import { teacherGraphSpan } from '@eduharness-studio/engine/teacher';
import type { PreparedLesson } from './lesson-lifecycle.js';
import type { SessionCursor } from './session-cursor.js';
import type { StoredSession, sessionDatabase } from './session-db.js';
import type { createSessionLocks } from './session-lock.js';
import { sameSession, saveTeacherTrace, type TeacherOperationLock } from './session-teacher.js';

type StartOptions = {
  courseId: string;
  lessonId: string;
  topic: string;
  prepare: () => PreparedLesson | Promise<PreparedLesson>;
  restart: boolean;
};

type Started = { created: boolean; snapshot: SessionSnapshot };
type StartResult =
  | Started
  | { error: 'session_not_found' | 'stale_generation' | 'teacher_turn_busy' | 'session_retired' };

type Store = ReturnType<typeof sessionDatabase>;
type OfflineTrace = (session: StoredSession, name: string, durationMs: number) => void;

export function createSessionOpening(
  store: Store,
  cursor: SessionCursor,
  traceOffline: OfflineTrace,
  locks: ReturnType<typeof createSessionLocks>,
) {
  async function startNew(
    options: StartOptions,
    previous: StoredSession | undefined,
    operation: TeacherOperationLock,
    sessionOperation?: TeacherOperationLock,
  ) {
    const { courseId, lessonId, topic } = options;
    const id = randomUUID();
    const began = performance.now();
    const prepared = await options.prepare();
    if ('error' in prepared) return prepared;
    const { script, basis, openingEvidence } = prepared;
    const offlineDuration = performance.now() - began;
    if (!validateLessonScript(script)) throw new Error('Invalid lesson script');
    const teacher = openingEvidence
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
        teacher,
        basis,
      });
      store.append(id, 'state', {
        from: null,
        to: 'intake',
        generation: 0,
        step_id: 0,
      } satisfies TeachingTransition);
      const snapshot = cursor.claim(session);
      if (openingEvidence) {
        const { diagnosis, durationMs, guardrails, graph, tools } = openingEvidence;
        const anchor = { generation: snapshot.generation, step_id: 0 };
        saveTeacherTrace(store, id, {
          trace: { ...anchor, trigger: 'opening', diagnosis, guardrails, outcome: 'accepted' },
          spans: [
            ...(tools ?? []).map((tool) => ({ ...anchor, ...tool, kind: 'tool' as const })),
            { ...anchor, kind: 'model', name: 'lesson_opening', durationMs },
            ...(graph ? [teacherGraphSpan(anchor.generation, graph)] : []),
          ],
        });
      } else traceOffline(session, 'lesson_script', offlineDuration);
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
