import {
  type Action,
  type LessonBeat,
  readCurrentLessonBeat,
  readLessonGeneration,
} from '@eduharness-studio/engine';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, request } from '@/lib/courses';

type SessionResponse = { session_id: string };

export function useLessonPlayback(lessonPath: string) {
  const [sessionId, setSessionId] = useState<string>();
  const sessionCreation = useRef<Promise<SessionResponse> | null>(null);
  const generationRef = useRef<number | undefined>(undefined);
  const [nextBeat, setNextBeat] = useState<LessonBeat>();
  const [played, setPlayed] = useState<Action[]>([]);
  const [paused, setPaused] = useState(false);
  const [stepRequested, setStepRequested] = useState(false);
  const [writing, setWriting] = useState<LessonBeat>();
  const [failedWrite, setFailedWrite] = useState<LessonBeat>();
  const [askStep, setAskStep] = useState<number>();
  const [answerText, setAnswerText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState('');
  const [end, setEnd] = useState<'done' | 'closed'>();
  const sessionPath = sessionId && `/sessions/${encodeURIComponent(sessionId)}`;
  const lastPlayed = played.at(-1)?.step_id ?? 0;

  useEffect(() => {
    // StrictMode re-runs effects, but one visit creates one persistent session.
    sessionCreation.current ??= request<SessionResponse>(`${lessonPath}/sessions`, {});
    let mounted = true;
    sessionCreation.current.then(
      ({ session_id }) => {
        if (mounted) setSessionId(session_id);
      },
      (reason: unknown) => {
        if (!mounted) return;
        setEnd('closed');
        setError(errorMessage(reason));
      },
    );
    return () => {
      mounted = false;
    };
  }, [lessonPath]);

  useEffect(() => {
    if (!sessionPath) return;
    const source = new EventSource(`/api${sessionPath}/stream`);
    let lastSequence = 0;

    function finish(status: 'done' | 'closed', message = '') {
      source.close();
      generationRef.current = undefined;
      setNextBeat(undefined);
      setFailedWrite(undefined);
      setEnd(status);
      setError(message);
    }

    source.addEventListener('stream', (raw) => {
      const nextGeneration = readLessonGeneration(JSON.parse((raw as MessageEvent<string>).data));
      if (nextGeneration === undefined || nextGeneration <= (generationRef.current ?? 0)) return;
      generationRef.current = nextGeneration;
      setNextBeat(undefined);
      setFailedWrite(undefined);
      setError('');
    });
    source.addEventListener('beat', (raw) => {
      const current = generationRef.current;
      if (current === undefined) return;
      const next = readCurrentLessonBeat(
        JSON.parse((raw as MessageEvent<string>).data),
        current,
        lastSequence,
      );
      if (!next) return;
      lastSequence = next.seq;
      setNextBeat(next);
    });
    function currentEvent(raw: Event) {
      const generation = readLessonGeneration(JSON.parse((raw as MessageEvent<string>).data));
      return generation !== undefined && generation === generationRef.current;
    }
    source.addEventListener('done', (raw) => {
      if (currentEvent(raw)) finish('done');
    });
    source.addEventListener('superseded', (raw) => {
      if (currentEvent(raw)) finish('closed', '此课堂已在另一处继续，请返回课程蓝图后重新进入。');
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED)
        finish('closed', '演播连接中断，请返回课程蓝图后重新进入。');
    };
    return () => source.close();
  }, [sessionPath]);

  useEffect(() => {
    if (!nextBeat || writing || failedWrite || end) return;
    const replay = nextBeat.action.step_id <= lastPlayed;
    if (!replay && (askStep !== undefined || (paused && !stepRequested))) return;
    const timer = window.setTimeout(
      () => {
        if (nextBeat.generation !== generationRef.current) return;
        setNextBeat((queued) => (queued === nextBeat ? undefined : queued));
        if (!replay) {
          setStepRequested(false);
          setPlayed((actions) => [...actions, nextBeat.action]);
          if (nextBeat.action.type === 'ask') {
            setAskStep(nextBeat.action.step_id);
            setPaused(true);
          }
        }
        setWriting(nextBeat);
      },
      paused || replay ? 0 : 900,
    );
    return () => window.clearTimeout(timer);
  }, [nextBeat, writing, failedWrite, end, lastPlayed, askStep, paused, stepRequested]);

  useEffect(() => {
    if (!writing || !sessionPath) return;
    // Report only after the corresponding whiteboard state commits. Its HTTP response never owns the next beat.
    let mounted = true;
    request(`${sessionPath}/progress`, {
      generation: writing.generation,
      last_played_step_id: writing.action.step_id,
    }).then(
      () => {
        if (!mounted) return;
        if (generationRef.current === writing.generation) setError('');
        setWriting(undefined);
      },
      () => {
        if (!mounted) return;
        if (generationRef.current === writing.generation) {
          setFailedWrite(writing);
          setStepRequested(false);
          setPaused(true);
          setError('已播内容未能保存，请重试保存。');
        }
        setWriting(undefined);
      },
    );
    return () => {
      mounted = false;
    };
  }, [sessionPath, writing]);

  const canToggle = Boolean(sessionPath && !end && !failedWrite && askStep === undefined);
  const canStep = canToggle && paused && !writing && !stepRequested;
  const canAnswer = Boolean(
    askStep !== undefined && !end && !writing && !failedWrite && !answering && answerText.trim(),
  );

  async function submitAnswer() {
    const generation = generationRef.current;
    if (!canAnswer || !sessionPath || askStep === undefined || generation === undefined) return;
    setAnswering(true);
    const submitted = { generation, ask_step_id: askStep, text: answerText.trim() };
    try {
      await request(`${sessionPath}/answer`, submitted);
      if (generationRef.current === undefined) return;
      setAnswerText('');
      setAskStep(undefined);
      setPaused(false);
      setError('');
    } catch (reason) {
      if (generationRef.current !== undefined) setError(errorMessage(reason));
    } finally {
      setAnswering(false);
    }
  }

  return {
    played,
    paused,
    end,
    error,
    starting: !sessionId && !end,
    canToggle,
    canStep,
    togglePaused() {
      setStepRequested(false);
      setPaused(!paused);
    },
    stepForward() {
      if (canStep) setStepRequested(true);
    },
    retrySave:
      failedWrite &&
      (() => {
        setFailedWrite(undefined);
        setWriting(failedWrite);
      }),
    askStep,
    answerText,
    canAnswer,
    setAnswerText,
    submitAnswer,
  };
}
