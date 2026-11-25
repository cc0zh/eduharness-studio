import {
  canTransition,
  type LessonRecord,
  type PlaybackWriteReceipt,
  projectKeypointProgress,
  readLessonBeat,
  type SessionSnapshot,
  stateAfterScriptBeat,
  type TeachingState,
  type TeachingTransition,
} from '@eduharness-studio/engine';
import type { Static } from '@sinclair/typebox';
import type { StoredSession, sessionDatabase } from './session-db.js';
import type { ResumeSchema } from './session-input.js';

export type CursorError = { error: 'session_not_found' | 'stale_generation' | 'unexpected_step' };
export type SessionCursor = ReturnType<typeof sessionCursor>;

export function sessionCursor(store: ReturnType<typeof sessionDatabase>) {
  function transition(session: StoredSession, to: TeachingState) {
    if (session.state === to) return;
    if (!canTransition(session.state, to)) throw new Error(`Invalid teaching transition to ${to}`);
    store.append(session.id, 'state', {
      from: session.state,
      to,
      generation: session.queue.generation,
      step_id: session.lastPlayed,
    } satisfies TeachingTransition);
    session.state = to;
  }

  function played({ lastPlayed, queue }: StoredSession) {
    return queue.script.actions.filter(({ step_id }) => step_id <= lastPlayed);
  }

  function keypoints(session: StoredSession) {
    return session.queue.teacher
      ? {
          keypoints: projectKeypointProgress(session.queue.script.keypoints, played(session))
            .keypoints,
        }
      : {};
  }

  function snapshot(session: StoredSession): SessionSnapshot {
    const { id, state, lastPlayed, queue } = session;
    return {
      session_id: id,
      generation: queue.generation,
      last_played_step_id: lastPlayed,
      playedActions: played(session),
      records: store.records(id),
      state,
      askStep: queue.askStep,
      // The snapshot's existing optional field keeps a mode-switch restart atomic for the player.
      keypoints: keypoints(session).keypoints ?? queue.script.keypoints,
    };
  }

  function supersede({ id, queue }: StoredSession) {
    if (queue.generation > 0) store.append(id, 'superseded', { generation: queue.generation });
  }

  function owned(id: string, generation: number): StoredSession | CursorError {
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

  function acknowledge(session: StoredSession, stepId: number): PlaybackWriteReceipt | CursorError {
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
    const state = stateAfterScriptBeat(session.state, next, queue.askStep !== null, queue.script);
    if (!state) return { error: 'unexpected_step' };

    session.lastPlayed = stepId;
    if (next.type === 'ask') queue.askStep = stepId;
    if (next.type === 'keypoint_unverified' && queue.teacher) {
      queue.teacher.lowEffortStreak = 0;
    }
    transition(session, state);
    store.save(session);
    store.append(session.id, 'played-step', { generation: queue.generation, step_id: stepId });
    return next.type === 'speak'
      ? record(session, {
          kind: 'subtitle',
          generation: queue.generation,
          step_id: stepId,
          text: next.text,
        })
      : { ok: true };
  }

  function claim(session: StoredSession): SessionSnapshot;
  function claim(
    session: StoredSession,
    receipt: Static<typeof ResumeSchema> | undefined,
  ): SessionSnapshot | CursorError;
  function claim(
    session: StoredSession,
    receipt?: Static<typeof ResumeSchema>,
  ): SessionSnapshot | CursorError {
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

  return { transition, played, keypoints, snapshot, supersede, owned, record, acknowledge, claim };
}
