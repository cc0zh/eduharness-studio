import {
  type LessonBeat,
  type LessonScript,
  type PlaybackWriteReceipt,
  readLessonBeat,
  type SessionSnapshot,
  type SessionTrace,
  stateAfterScriptBeat,
  validateLessonScript,
} from '@eduharness-studio/engine';
import type { TeacherPlanner } from '@eduharness-studio/engine/teacher';
import type { Static } from '@sinclair/typebox';
import { type CursorError, sessionCursor } from './session-cursor.js';
import type { StoredSession, sessionDatabase } from './session-db.js';
import type { ProgressSchema, ResumeSchema } from './session-input.js';
import { createSessionTurns } from './session-turns.js';

type ActiveStream = { id: string; generation: number; script?: LessonScript; sentStep: number };
type BeatPoll =
  | { kind: 'beat'; beat: LessonBeat }
  | { kind: 'waiting' }
  | { kind: 'done' | 'interrupted' | 'superseded'; snapshot: SessionSnapshot };

export function createSessionStore(
  store: ReturnType<typeof sessionDatabase>,
  plan: TeacherPlanner = async () => {
    throw new Error('A model turn was requested without a configured teacher planner');
  },
) {
  const cursor = sessionCursor(store);
  const turns = createSessionTurns(store, cursor, plan);

  function streamEnd(id: string, kind: 'done' | 'interrupted' | 'superseded'): BeatPoll {
    const session = store.load(id);
    if (!session) throw new Error('Missing lesson session at stream end');
    return { kind, snapshot: cursor.snapshot(session) };
  }

  function currentLesson<T>(
    courseId: string,
    lessonId: string,
    read: (session: StoredSession) => T,
  ) {
    return store.readTransaction(() => {
      const session = store.latest(courseId, lessonId);
      if (session) return read(session);
      return store.hasUnversioned(courseId, lessonId)
        ? { error: 'session_retired' as const }
        : null;
    });
  }

  return {
    ...turns,
    inspect(id: string) {
      return store.readTransaction(() => {
        const session = store.load(id);
        if (!session) return undefined;
        const trace: SessionTrace = {
          generation: session.queue.generation,
          last_played_step_id: session.lastPlayed,
          queued: session.queue.script.actions
            .filter(({ step_id }) => step_id > session.lastPlayed)
            .map(({ step_id, type }) => ({ step_id, type })),
          ...store.diagnostics(id),
        };
        return { trace, snapshot: cursor.snapshot(session) };
      });
    },
    active(courseId: string, lessonId: string) {
      return currentLesson(courseId, lessonId, cursor.snapshot);
    },
    outline(courseId: string, lessonId: string) {
      return currentLesson(courseId, lessonId, (session) => session.queue.script.keypoints);
    },
    isUnversioned(id: string) {
      return store.hasUnversionedId(id);
    },
    resume(id: string, receipt?: Static<typeof ResumeSchema>) {
      return store.transaction(() => {
        const session = store.load(id);
        if (!session) {
          return store.hasUnversionedId(id) ? { error: 'session_retired' as const } : undefined;
        }
        if (session.queue.retired) return undefined;
        return cursor.claim(session, receipt);
      });
    },
    openStream(
      id: string,
      generation: number,
    ): ActiveStream | { error: 'session_retired' } | undefined {
      const session = store.load(id);
      if (!session) {
        return store.hasUnversionedId(id) ? { error: 'session_retired' } : undefined;
      }
      if (session.queue.generation !== generation || session.queue.retired) {
        return { id, generation, sentStep: 0 };
      }
      if (!validateLessonScript(session.queue.script))
        throw new Error('Invalid stored lesson session');
      return { id, generation, script: session.queue.script, sentStep: 0 };
    },
    poll(active: ActiveStream): BeatPoll {
      return store.transaction(() => {
        const { id, generation } = active;
        const position = store.header(id);
        if (!active.script || !position || position.retired || position.generation !== generation) {
          const ownSuccessor =
            position?.generation === generation + 1 &&
            !position.retired &&
            store.wasInterrupted(id, generation);
          return streamEnd(id, ownSuccessor ? 'interrupted' : 'superseded');
        }
        if (position.askStep !== null || turns.isPlanning(id)) return { kind: 'waiting' };
        const nextAction = (script: LessonScript) =>
          script.actions.find(({ step_id }) => step_id > position.lastPlayed);
        let action = nextAction(active.script);
        if (!action && position.state === 'completed') return streamEnd(id, 'done');
        if (!action) {
          // A live answer appends a verified batch in the same generation.
          const updated = store.load(id);
          if (updated?.queue.teacher) {
            active.script = updated.queue.script;
            action = nextAction(active.script);
          }
        }
        if (!action || !stateAfterScriptBeat(position.state, action, false, active.script)) {
          throw new Error('Lesson action blocked by teaching state');
        }
        if (action.step_id === active.sentStep) return { kind: 'waiting' };
        const sent = readLessonBeat(store.lastEvent(id, 'beat'));
        // Claim, cursor, sent-event read and issue are serialized across SQLite connections.
        if (sent?.generation === generation && sent.action.step_id === action.step_id) {
          active.sentStep = action.step_id;
          return { kind: 'beat', beat: sent };
        }
        const beat = { generation, seq: (sent?.seq ?? 0) + 1, action };
        store.append(id, 'beat', beat);
        active.sentStep = action.step_id;
        return { kind: 'beat', beat };
      });
    },
    progress(id: string, input: Static<typeof ProgressSchema>): PlaybackWriteReceipt | CursorError {
      return store.transaction(() => {
        const session = cursor.owned(id, input.generation);
        return 'error' in session
          ? session
          : cursor.acknowledge(session, input.last_played_step_id);
      });
    },
  };
}
