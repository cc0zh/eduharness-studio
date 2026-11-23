import { randomUUID } from 'node:crypto';
import {
  buildInterruptQueue,
  canTransition,
  type LessonBeat,
  type LessonRecord,
  type LessonScript,
  type PlaybackWriteReceipt,
  readLessonBeat,
  type SessionSnapshot,
  stateAfterBeat,
  type TeachingState,
  validateLessonScript,
} from '@eduharness-studio/engine';
import type { Static } from '@sinclair/typebox';
import type { StudioDatabase } from './db.js';
import { type StoredSession, sessionDatabase } from './session-db.js';
import type {
  AnswerSchema,
  InterruptSchema,
  ProgressSchema,
  ResumeSchema,
} from './session-input.js';

type ActiveStream = { id: string; generation: number; script?: LessonScript; sentStep: number };
type BeatPoll =
  | { kind: 'beat'; beat: LessonBeat }
  | { kind: 'waiting' }
  | { kind: 'done' | 'interrupted' | 'superseded'; snapshot: SessionSnapshot };
type WriteError = { error: 'session_not_found' | 'stale_generation' | 'unexpected_step' };
type WriteResult = PlaybackWriteReceipt | WriteError;

export function createSessionStore({ db }: StudioDatabase) {
  const store = sessionDatabase(db);

  function transition(session: StoredSession, to: TeachingState) {
    if (session.state === to) return;
    if (!canTransition(session.state, to)) throw new Error(`Invalid teaching transition to ${to}`);
    store.append(session.id, 'state', {
      from: session.state,
      to,
      generation: session.queue.generation,
      step_id: session.lastPlayed,
    });
    session.state = to;
  }

  function snapshot({ id, state, lastPlayed, queue }: StoredSession): SessionSnapshot {
    return {
      session_id: id,
      generation: queue.generation,
      last_played_step_id: lastPlayed,
      playedActions: queue.script.actions.filter(({ step_id }) => step_id <= lastPlayed),
      records: store.records(id),
      state,
      askStep: queue.askStep,
    };
  }

  function streamEnd(id: string, kind: 'done' | 'interrupted' | 'superseded'): BeatPoll {
    const session = store.load(id);
    if (!session) throw new Error('Missing lesson session at stream end');
    return { kind, snapshot: snapshot(session) };
  }

  function supersede({ id, queue }: StoredSession) {
    if (queue.generation > 0) store.append(id, 'superseded', { generation: queue.generation });
  }

  function claim(
    session: StoredSession,
    receipt?: Static<typeof ResumeSchema>,
  ): SessionSnapshot | WriteError {
    if (
      receipt &&
      'generation' in receipt &&
      receipt.generation === session.queue.generation &&
      receipt.last_played_step_id > session.lastPlayed
    ) {
      const confirmed = acknowledge(session, receipt.last_played_step_id);
      if ('error' in confirmed) return confirmed;
    }
    supersede(session);
    ++session.queue.generation;
    if (session.state === 'intake') transition(session, 'diagnose');
    store.append(session.id, 'stream', { generation: session.queue.generation });
    store.save(session);
    return snapshot(session);
  }

  function owned(id: string, generation: number): StoredSession | WriteError {
    const session = store.load(id);
    if (!session) return { error: 'session_not_found' };
    if (session.queue.retired || session.queue.generation !== generation) {
      return { error: 'stale_generation' };
    }
    return session;
  }

  function record(session: StoredSession, entry: LessonRecord): PlaybackWriteReceipt {
    store.append(session.id, entry.kind, entry);
    return { ok: true, record: entry };
  }

  function acknowledge(session: StoredSession, stepId: number): WriteResult {
    if (session.lastPlayed === stepId) {
      const last = store.lastEvent(session.id, 'subtitle') as LessonRecord | undefined;
      return last?.kind === 'subtitle' && last.step_id === stepId
        ? { ok: true, record: last }
        : { ok: true };
    }
    const { queue } = session;
    const next = queue.script.actions.find(({ step_id }) => step_id > session.lastPlayed);
    const sent = readLessonBeat(store.lastEvent(session.id, 'beat'));
    if (
      stepId !== next?.step_id ||
      sent?.generation !== queue.generation ||
      sent.action.step_id !== stepId
    ) {
      return { error: 'unexpected_step' };
    }
    const state = stateAfterBeat(
      session.state,
      next,
      queue.askStep !== null,
      next === queue.script.actions.at(-1),
    );
    if (!state) return { error: 'unexpected_step' };

    session.lastPlayed = stepId;
    if (next.type === 'ask') queue.askStep = stepId;
    transition(session, state);
    store.save(session);
    return next.type === 'speak'
      ? record(session, {
          kind: 'subtitle',
          generation: queue.generation,
          step_id: stepId,
          text: next.text,
        })
      : { ok: true };
  }

  return {
    active(courseId: string, lessonId: string) {
      return store.readTransaction(() => {
        const session = store.latest(courseId, lessonId);
        if (session) return snapshot(session);
        return store.hasUnversioned(courseId, lessonId)
          ? { error: 'session_retired' as const }
          : null;
      });
    },
    isUnversioned(id: string) {
      return store.hasUnversionedId(id);
    },
    start(
      courseId: string,
      lessonId: string,
      topic: string,
      script: LessonScript,
      restart: boolean,
    ) {
      return store.transaction(() => {
        const previous = store.latest(courseId, lessonId);
        if (previous && !restart) return { created: false, snapshot: claim(previous) };
        if (!previous && !restart && store.hasUnversioned(courseId, lessonId)) {
          return { error: 'session_retired' as const };
        }
        if (!validateLessonScript(script)) throw new Error('Invalid lesson script');
        if (previous) {
          supersede(previous);
          previous.queue.retired = true;
          store.save(previous);
        }
        const session = store.insert(randomUUID(), courseId, lessonId, topic, script);
        store.append(session.id, 'state', { from: null, to: 'intake', generation: 0, step_id: 0 });
        return { created: true, snapshot: claim(session) };
      });
    },
    resume(id: string, receipt?: Static<typeof ResumeSchema>) {
      return store.transaction(() => {
        const session = store.load(id);
        if (!session) {
          return store.hasUnversionedId(id) ? { error: 'session_retired' as const } : undefined;
        }
        if (session.queue.retired) return undefined;
        return claim(session, receipt);
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
        const { id, generation, script } = active;
        const position = store.header(id);
        if (!script || !position || position.retired || position.generation !== generation) {
          const ownSuccessor =
            position?.generation === generation + 1 &&
            !position.retired &&
            store.wasInterrupted(id, generation);
          return streamEnd(id, ownSuccessor ? 'interrupted' : 'superseded');
        }
        if (position.askStep !== null) return { kind: 'waiting' };
        const action = script.actions.find(({ step_id }) => step_id > position.lastPlayed);
        if (!action && position.state === 'completed') return streamEnd(id, 'done');
        if (
          !action ||
          !stateAfterBeat(position.state, action, false, action === script.actions.at(-1))
        ) {
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
    progress(id: string, input: Static<typeof ProgressSchema>): WriteResult {
      return store.transaction(() => {
        const session = owned(id, input.generation);
        return 'error' in session ? session : acknowledge(session, input.last_played_step_id);
      });
    },
    answer(
      id: string,
      { generation, ask_step_id, text }: Static<typeof AnswerSchema>,
    ): WriteResult {
      return store.transaction(() => {
        const session = owned(id, generation);
        if ('error' in session) return session;
        const previous = store.lastEvent(id, 'answer') as LessonRecord | undefined;
        if (
          previous?.kind === 'answer' &&
          previous.ask_step_id === ask_step_id &&
          previous.text === text.trim()
        ) {
          return { ok: true, record: previous };
        }
        if (session.queue.askStep !== ask_step_id || session.state !== 'handoff') {
          return { error: 'unexpected_step' };
        }
        session.queue.askStep = null;
        store.save(session);
        return record(session, { kind: 'answer', generation, ask_step_id, text: text.trim() });
      });
    },
    interrupt(id: string, input: Static<typeof InterruptSchema>): SessionSnapshot | WriteError {
      return store.transaction(() => {
        const session = owned(id, input.generation);
        if ('error' in session) return session;
        const { queue } = session;
        if (
          session.state === 'completed' ||
          input.last_played_step_id === queue.script.actions.at(-1)?.step_id
        ) {
          return { error: 'unexpected_step' };
        }
        if (session.lastPlayed !== input.last_played_step_id) {
          // The interruption can carry the one committed frame whose standalone ACK is still in flight.
          const ack = acknowledge(session, input.last_played_step_id);
          if ('error' in ack) return ack;
        }
        const text = input.text.trim();
        const cut = buildInterruptQueue(
          queue.script,
          session.lastPlayed || null,
          text,
          queue.topic,
        );
        queue.script = { ...queue.script, actions: cut.actions };
        queue.askStep = null;
        ++queue.generation;
        transition(session, 'diagnose');
        record(session, {
          kind: 'interrupt',
          generation: queue.generation,
          previous_generation: input.generation,
          last_played_step_id: session.lastPlayed,
          truncated_step_ids: cut.truncated.map(({ step_id }) => step_id),
          intent: cut.intent,
          text,
        });
        store.append(id, 'stream', { generation: queue.generation });
        store.save(session);
        return snapshot(session);
      });
    },
  };
}
