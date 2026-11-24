import type {
  LessonBeat,
  PlaybackProgressResult,
  PlaybackWriteReceipt,
  SessionSnapshot,
} from '@eduharness-studio/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { errorMessage, request } from '@/lib/courses';
import { addRecord, playbackOwner } from './lesson-playback-state';
import { restartLesson, resumeLesson, sessionPath } from './lesson-session';
import { subscribeLesson } from './lesson-stream';
import {
  clearPendingProgress,
  readViewPreference,
  writePendingProgress,
  writeViewPreference,
} from './lesson-view-preferences';
import { usePageVisibility } from './usePageVisibility';

type LessonMutation = { kind: 'answer' | 'interrupt' | 'restart'; owner: string | undefined };

export function useLessonPlayback(lessonPath: string) {
  const [session, setSession] = useState<SessionSnapshot>();
  const [ready, setReady] = useState(false);
  const [nextBeat, setNextBeat] = useState<LessonBeat>();
  const [pausedByStudent, setPaused] = useState(false);
  const [stepRequested, setStepRequested] = useState(false);
  const [writing, setWriting] = useState(false);
  const [failedWrite, setFailedWrite] = useState<LessonBeat>();
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState<'done' | 'closed'>();
  const [error, setError] = useState('');
  const [answerText, setAnswerText] = useState('');
  const visible = usePageVisibility();
  const opening = useRef<Promise<SessionSnapshot> | null>(null);
  const owner = useRef<string | undefined>(undefined);
  const mutation = useRef<LessonMutation | undefined>(undefined);
  const displayed = useRef(0);

  const sessionId = session?.session_id;
  const generation = session?.generation;
  const askStep = session?.askStep ?? null;
  const paused = pausedByStudent || askStep !== null;

  const install = useCallback((snapshot: SessionSnapshot) => {
    owner.current = playbackOwner(snapshot.session_id, snapshot.generation);
    displayed.current = snapshot.last_played_step_id;
    clearPendingProgress(snapshot.session_id);
    setReady(false);
    setNextBeat(undefined);
    setStepRequested(false);
    setFailedWrite(undefined);
    setWriting(false);
    setPaused(readViewPreference(snapshot.session_id, 'paused') === 'yes');
    setAnswerText('');
    setEnd(snapshot.state === 'completed' ? 'done' : undefined);
    setError('');
    setSession(snapshot);
  }, []);

  const settle = useCallback((operation: LessonMutation | undefined) => {
    if (operation && mutation.current === operation) {
      mutation.current = undefined;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    // The StrictMode effect replay shares the same find/claim request.
    opening.current ??= resumeLesson(lessonPath);
    opening.current.then(
      (snapshot) => {
        if (mounted) install(snapshot);
      },
      (reason: unknown) => {
        if (!mounted) return;
        setEnd('closed');
        setError(errorMessage(reason));
      },
    );
    return () => {
      mounted = false;
      owner.current = undefined;
      mutation.current = undefined;
    };
  }, [lessonPath, install]);

  useEffect(() => {
    if (!sessionId || generation === undefined || end) return;
    const current = playbackOwner(sessionId, generation);
    return subscribeLesson(sessionId, generation, {
      ready(connected) {
        if (owner.current === current) setReady(connected);
      },
      beat(beat) {
        if (owner.current === current && beat.action.step_id > displayed.current) setNextBeat(beat);
      },
      end(event) {
        if (owner.current !== current) return;
        const operation = mutation.current;
        const restarting = operation?.kind === 'restart' && operation.owner === current;
        if (!restarting) settle(operation);
        setReady(false);
        setNextBeat(undefined);
        if (event.kind !== 'unavailable') install(event.snapshot);
        if (event.kind === 'interrupted') return;
        owner.current = undefined;
        setWriting(false);
        setFailedWrite(undefined);
        if (event.kind === 'done') return;
        setEnd('closed');
        if (restarting) return;
        setError(
          event.kind === 'superseded'
            ? '此课堂已在另一处继续。请刷新页面以在这里接着上课。'
            : '演播连接中断。请刷新页面以恢复已播内容。',
        );
      },
    });
  }, [sessionId, generation, end, install, settle]);

  const saveProgress = useCallback((id: string, beat: LessonBeat) => {
    const key = playbackOwner(id, beat.generation);
    writePendingProgress(id, {
      generation: beat.generation,
      last_played_step_id: beat.action.step_id,
    });
    setWriting(true);
    void request<PlaybackProgressResult>(
      `${sessionPath(id)}/progress`,
      { generation: beat.generation, last_played_step_id: beat.action.step_id },
      { keepalive: true },
    )
      .then(
        (receipt) => {
          if (owner.current !== key) return;
          if ('error' in receipt) {
            setReady(false);
            setNextBeat(undefined);
            return;
          }
          const { record } = receipt;
          clearPendingProgress(id);
          setSession((snapshot) => addRecord(snapshot, record));
        },
        () => {
          if (owner.current !== key) return;
          setFailedWrite(beat);
          setStepRequested(false);
          setError('已播内容未能保存，请重试保存。');
        },
      )
      .finally(() => {
        if (owner.current === key) setWriting(false);
      });
  }, []);

  useEffect(() => {
    if (
      !sessionId ||
      !ready ||
      !visible ||
      !nextBeat ||
      writing ||
      failedWrite ||
      busy ||
      end ||
      askStep !== null
    )
      return;
    if (paused && !stepRequested) return;
    const key = playbackOwner(sessionId, nextBeat.generation);
    const timer = window.setTimeout(
      () => {
        if (
          owner.current !== key ||
          mutation.current ||
          !visible ||
          document.visibilityState !== 'visible' ||
          nextBeat.action.step_id <= displayed.current
        )
          return;
        const action = nextBeat.action;
        // Finish the DOM commit before either progress or an interrupt can observe this step.
        flushSync(() => {
          setNextBeat((queued) => (queued === nextBeat ? undefined : queued));
          setStepRequested(false);
          setWriting(true);
          setSession(
            (snapshot) =>
              snapshot && {
                ...snapshot,
                last_played_step_id: action.step_id,
                playedActions: [...snapshot.playedActions, action],
                askStep: action.type === 'ask' ? action.step_id : snapshot.askStep,
              },
          );
        });
        displayed.current = action.step_id;
        saveProgress(sessionId, nextBeat);
      },
      paused ? 0 : 900,
    );
    return () => window.clearTimeout(timer);
  }, [
    sessionId,
    ready,
    nextBeat,
    writing,
    failedWrite,
    busy,
    end,
    askStep,
    paused,
    stepRequested,
    visible,
    saveProgress,
  ]);

  const canToggle = Boolean(ready && !busy && !end && !failedWrite && askStep === null);
  const canStep = canToggle && paused && !writing && !stepRequested;
  const canAnswer = Boolean(
    ready && askStep !== null && !end && !writing && !failedWrite && !busy && answerText.trim(),
  );
  const canInterrupt = ready && !end && !busy;
  const canRestart = Boolean(!busy && (sessionId || end === 'closed'));

  function pause(value: boolean) {
    if (sessionId) writeViewPreference(sessionId, 'paused', value ? 'yes' : null);
    setPaused(value);
  }

  async function mutate(
    kind: LessonMutation['kind'],
    work: (isCurrent: () => boolean) => Promise<void>,
  ) {
    const operation = { kind, owner: owner.current };
    if (mutation.current || (!operation.owner && kind !== 'restart')) return false;
    mutation.current = operation;
    setBusy(true);
    setError('');
    const isCurrent = () =>
      mutation.current === operation && (kind === 'restart' || owner.current === operation.owner);
    try {
      await work(isCurrent);
      return true;
    } catch (reason) {
      if (isCurrent()) setError(`${errorMessage(reason)} 如未能继续，请刷新恢复课堂。`);
      return false;
    } finally {
      settle(operation);
    }
  }

  return {
    sessionId,
    generation,
    played: session?.playedActions ?? [],
    records: session?.records ?? [],
    pendingBeat: nextBeat,
    saving: writing,
    paused,
    end,
    error,
    busy,
    starting: !ready && !end,
    canToggle,
    canStep,
    togglePaused() {
      if (!canToggle) return;
      setStepRequested(false);
      pause(!paused);
    },
    stepForward() {
      if (canStep) setStepRequested(true);
    },
    retrySave:
      failedWrite && !busy && sessionId
        ? () => {
            setError('');
            setFailedWrite(undefined);
            saveProgress(sessionId, failedWrite);
          }
        : undefined,
    askStep,
    answerText,
    canAnswer,
    setAnswerText,
    async submitAnswer() {
      if (!canAnswer || !sessionId || generation === undefined || askStep === null) return;
      const text = answerText.trim();
      await mutate('answer', async (isCurrent) => {
        const { record } = await request<PlaybackWriteReceipt>(`${sessionPath(sessionId)}/answer`, {
          generation,
          ask_step_id: askStep,
          text,
        });
        if (!isCurrent()) return;
        setSession((snapshot) => addRecord(snapshot && { ...snapshot, askStep: null }, record));
        setAnswerText('');
        pause(false);
      });
    },
    canInterrupt,
    async interrupt(text: string) {
      if (!canInterrupt || !sessionId || generation === undefined || !text.trim()) return false;
      const last_played_step_id = displayed.current;
      return mutate('interrupt', async (isCurrent) => {
        const snapshot = await request<SessionSnapshot>(`${sessionPath(sessionId)}/interrupt`, {
          generation,
          last_played_step_id,
          text: text.trim(),
        });
        if (isCurrent()) install(snapshot);
      });
    },
    canRestart,
    async restart() {
      if (!canRestart) return;
      await mutate('restart', async (isCurrent) => {
        const snapshot = await restartLesson(lessonPath, sessionId);
        if (!isCurrent()) return;
        if (sessionId) clearPendingProgress(sessionId);
        install(snapshot);
      });
    },
  };
}
