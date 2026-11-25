import {
  type Action,
  buildInterruptQueue,
  classifyInterrupt,
  type LessonRecord,
  type LessonTraceSpan,
  truncateOnInterrupt,
  validateLessonScript,
} from '@eduharness-studio/engine';
import type { TeacherPlanner, TeacherProgress } from '@eduharness-studio/engine/teacher';
import type { Static } from '@sinclair/typebox';
import type { SessionCursor } from './session-cursor.js';
import type { StoredSession, sessionDatabase } from './session-db.js';
import type { AnswerSchema, InterruptSchema } from './session-input.js';
import { createSessionLocks } from './session-lock.js';
import { createSessionOpening } from './session-opening.js';
import {
  runSessionTeacher,
  sameSession,
  teacherContext,
  teacherFailed,
} from './session-teacher.js';
import { createTeacherFallback } from './teacher-fallback.js';

const unexpected = { error: 'unexpected_step' } as const;
const stale = { error: 'stale_generation' } as const;

export function createSessionTurns(
  store: ReturnType<typeof sessionDatabase>,
  cursor: SessionCursor,
  planTurn: TeacherPlanner,
) {
  const locks = createSessionLocks(store);
  const applyTeacherTurn = runSessionTeacher(store, cursor, planTurn);

  function traceOffline(session: StoredSession, name: string, durationMs: number) {
    store.append(session.id, 'trace', {
      kind: 'offline',
      name,
      durationMs,
      generation: session.queue.generation,
      step_id: session.lastPlayed,
    } satisfies LessonTraceSpan);
  }
  const opening = createSessionOpening(store, cursor, traceOffline, locks);
  const fallback = createTeacherFallback(store, cursor, traceOffline);

  function answer(id: string, input: Static<typeof AnswerSchema>) {
    return locks.run(`session:${id}:${input.generation}`, async (operation) => {
      const { generation, ask_step_id } = input;
      const prepared = store.readTransaction(() => {
        const session = store.load(id);
        if (!session) return { error: 'session_not_found' } as const;
        if (session.queue.retired || session.queue.generation !== generation) return stale;
        const option_id = 'option_id' in input ? input.option_id : undefined;
        const ask = session.queue.script.actions.find(({ step_id }) => step_id === ask_step_id);
        const text =
          'text' in input
            ? input.text.trim()
            : ask?.type === 'ask' && ask.mode === 'choice'
              ? ask.options?.find(({ id }) => id === option_id)?.label
              : undefined;
        if (!text) return unexpected;
        const entry = { kind: 'answer', generation, ask_step_id, text } satisfies LessonRecord;
        const previous = store.lastEvent(id, 'answer') as LessonRecord | undefined;
        if (
          previous?.kind === 'answer' &&
          previous.ask_step_id === ask_step_id &&
          previous.text === text
        ) {
          return {
            receipt: { ok: true as const, record: previous, ...cursor.keypoints(session) },
          };
        }
        if (session.queue.askStep !== ask_step_id || session.state !== 'handoff') return unexpected;
        return {
          session,
          entry,
          option_id,
          progress: session.queue.teacher,
        };
      });
      if ('error' in prepared) return prepared;
      if ('receipt' in prepared) return prepared.receipt;
      const { session, entry, option_id, progress } = prepared;
      if (progress) {
        const planned = await applyTeacherTurn(
          session,
          teacherContext(cursor, session, { ...entry, choice: option_id !== undefined }, progress),
          (current, plan) => {
            cursor.transition(current, plan.initialState);
            store.save(current);
            return { ...cursor.record(current, entry), ...cursor.keypoints(current) };
          },
          operation,
        );
        if ('failure' in planned && planned.failure === 'model_offline') {
          return fallback.answer(session, entry, operation, option_id);
        }
        return planned;
      }
      return store.transaction(() => {
        const current = cursor.owned(id, generation);
        if ('error' in current) return current;
        if (!store.ownsTeacherLock(operation.scope, operation.token)) return stale;
        if (!sameSession(session, current)) return stale;
        current.queue.askStep = null;
        store.save(current);
        return cursor.record(current, entry);
      });
    });
  }

  function finishInterrupt(session: StoredSession, text: string, truncated: Action[]) {
    const previous_generation = session.queue.generation;
    ++session.queue.generation;
    session.queue.askStep = null;
    cursor.transition(session, 'diagnose');
    cursor.record(session, {
      kind: 'interrupt',
      generation: session.queue.generation,
      previous_generation,
      last_played_step_id: session.lastPlayed,
      truncated_step_ids: truncated.map(({ step_id }) => step_id),
      intent: classifyInterrupt(text),
      text,
    });
    store.append(session.id, 'stream', { generation: session.queue.generation });
    store.save(session);
    return cursor.snapshot(session);
  }

  function interrupt(id: string, input: Static<typeof InterruptSchema>) {
    return locks.run(`session:${id}:${input.generation}`, async (operation) => {
      const text = input.text.trim();
      const prepared = store.transaction(() => {
        const session = cursor.owned(id, input.generation);
        if ('error' in session) return session;
        const { queue } = session;
        if (!queue.teacher && input.last_played_step_id === queue.script.actions.at(-1)?.step_id)
          return unexpected;
        // This receipt may confirm the one committed DOM frame whose separate ACK is still in flight.
        const ack = cursor.acknowledge(session, input.last_played_step_id);
        if ('error' in ack) return ack;
        if (session.state === 'completed') return unexpected;
        if (!queue.teacher) {
          const began = performance.now();
          const cut = buildInterruptQueue(
            queue.script,
            session.lastPlayed || null,
            text,
            queue.topic,
          );
          queue.script = { ...queue.script, actions: cut.actions };
          const snapshot = finishInterrupt(session, text, cut.truncated);
          traceOffline(session, 'interrupt_continuation', performance.now() - began);
          return snapshot;
        }
        return { session, progress: queue.teacher };
      });
      if (!('session' in prepared)) return prepared;
      const { session, progress } = prepared;
      const cut = truncateOnInterrupt(session.queue.script.actions, session.lastPlayed || null);
      const truncatedIds = cut.truncated.flatMap((action) => {
        if (action.type === 'new_page') return [action.page_id];
        return 'card_id' in action ? [action.card_id] : [];
      });
      const nextProgress: TeacherProgress = {
        ...progress,
        truncatedCardIds: [...new Set([...progress.truncatedCardIds, ...truncatedIds])],
      };
      return applyTeacherTurn(
        session,
        teacherContext(cursor, session, { kind: 'interrupt', text }, nextProgress),
        (current) => finishInterrupt(current, text, cut.truncated),
        operation,
      ).then((planned) => {
        if (!('failure' in planned) || planned.failure !== 'model_offline') return planned;
        return store.transaction(() => {
          const current = cursor.owned(id, input.generation);
          if ('error' in current) return current;
          if (
            !store.ownsTeacherLock(operation.scope, operation.token) ||
            !sameSession(session, current)
          ) {
            return stale;
          }
          const actions = fallback.unavailableActions(current, cut.played, nextProgress, false);
          const script = {
            keypoints: current.queue.script.keypoints,
            actions: [...cut.played, ...actions],
          };
          if (!validateLessonScript(script)) return teacherFailed;
          current.queue.script = script;
          current.queue.teacher = {
            ...nextProgress,
            highWater: actions.at(-1)?.step_id ?? nextProgress.highWater,
          };
          const snapshot = finishInterrupt(current, text, cut.truncated);
          traceOffline(current, 'teacher_model_unavailable_fallback', 0);
          return snapshot;
        });
      });
    });
  }

  return {
    start: opening.start,
    answer,
    interrupt,
    isPlanning: (id: string) => store.hasTeacherLock(`session:${id}:`),
  };
}
