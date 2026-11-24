import type { LessonRecord } from '@eduharness-studio/engine';
import {
  type Action,
  projectKeypointProgress,
  validateLessonScript,
} from '@eduharness-studio/engine';
import { effortSignal, type TeacherProgress } from '@eduharness-studio/engine/teacher';
import type { SessionCursor } from './session-cursor.js';
import type { StoredSession, sessionDatabase } from './session-db.js';
import { sameSession, type TeacherOperationLock } from './session-teacher.js';

type Store = ReturnType<typeof sessionDatabase>;

export function createTeacherFallback(
  store: Store,
  cursor: SessionCursor,
  traceOffline: (session: StoredSession, name: string, durationMs: number) => void,
) {
  function unavailableActions(
    session: StoredSession,
    played: readonly Action[],
    progress: TeacherProgress,
    markUnverified: boolean,
    firstLowEffort = false,
  ): Action[] {
    const { keypoints, currentIndex } = projectKeypointProgress(
      session.queue.script.keypoints,
      played,
    );
    const current = keypoints[currentIndex];
    if (!current) throw new Error('Missing active keypoint in teacher fallback');
    const next = keypoints[currentIndex + 1];
    let step = Math.max(progress.highWater, session.queue.script.actions.at(-1)?.step_id ?? 0);
    const id = `offline-${step + 1}`;
    const actions: Action[] = [];
    const speak = (text: string) => actions.push({ type: 'speak', step_id: ++step, text });
    const board = (point: typeof current, cardId: string) =>
      actions.push({
        type: 'board',
        step_id: ++step,
        column: 1,
        card_id: cardId,
        title: point.title.slice(0, 48),
        content: point.objective.slice(0, 180),
        depth: point.depth,
      });
    const unverified = () =>
      actions.push({
        type: 'keypoint_unverified',
        step_id: ++step,
        keypoint_id: current.id,
      });
    const ask = (point: typeof current, cardId: string) =>
      actions.push({
        type: 'ask',
        step_id: ++step,
        card_id: cardId,
        prompt: `围绕「${point.title}」：${point.objective}`.slice(0, 140),
        mode: 'open',
      });

    if (firstLowEffort) {
      speak('先不用写理由，选一个最接近直觉的判断。');
      board(current, id);
      speak(`先看「${current.title.slice(0, 48)}」里的两个关键条件。`);
      actions.push({
        type: 'ask',
        step_id: ++step,
        card_id: `${id}-ask`,
        prompt: `围绕「${current.title}」，哪种判断更接近你的直觉？`.slice(0, 140),
        mode: 'choice',
        options: [
          { id: 'intuitive-1', label: '先选一个具体例子试试' },
          { id: 'intuitive-2', label: '先看另一个例子再判断' },
        ],
      });
    } else if (markUnverified && next) {
      speak('先保留刚才的回答。这个要点暂不记作掌握，我们再看下一个具体例子。');
      unverified();
      board(next, id);
      speak(`换到「${next.title.slice(0, 48)}」，先观察一个具体情境。`);
      ask(next, `${id}-ask`);
    } else if (markUnverified) {
      speak('先保留刚才的回答。这个要点暂不记作掌握，我们再检查白板上的具体条件。');
      board(current, id);
      speak(`回看「${current.title.slice(0, 48)}」：先辨认它依赖的条件。`);
      unverified();
    } else {
      speak('沿用白板上已经确认的内容，再换一个具体例子。');
      board(current, id);
      speak(`从「${current.title.slice(0, 48)}」的一个例子重新开始。`);
      ask(current, `${id}-ask`);
    }
    return actions;
  }

  function answer(
    expected: StoredSession,
    entry: Extract<LessonRecord, { kind: 'answer' }>,
    operation: TeacherOperationLock,
    optionId?: string,
  ) {
    return store.transaction(() => {
      const current = cursor.owned(expected.id, expected.queue.generation);
      if ('error' in current) return current;
      if (
        !store.ownsTeacherLock(operation.scope, operation.token) ||
        !sameSession(expected, current)
      ) {
        return { error: 'stale_generation' } as const;
      }
      const progress = current.queue.teacher;
      if (!progress) return { error: 'teacher_turn_failed' } as const;
      const played = cursor.played(current);
      const signal = effortSignal({
        kind: 'answer',
        ask_step_id: entry.ask_step_id,
        text: entry.text,
        option_id: optionId,
      });
      const firstLowEffort = signal === 'low' && progress.lowEffortStreak === 0;
      const actions = unavailableActions(
        current,
        played,
        progress,
        !firstLowEffort,
        firstLowEffort,
      );
      const script = {
        keypoints: current.queue.script.keypoints,
        actions: [...played, ...actions],
      };
      if (!validateLessonScript(script)) return { error: 'teacher_turn_failed' } as const;
      current.queue.script = script;
      current.queue.askStep = null;
      current.queue.teacher = {
        ...progress,
        highWater: actions.at(-1)?.step_id ?? progress.highWater,
        lowEffortStreak: firstLowEffort ? 1 : progress.lowEffortStreak,
      };
      cursor.transition(current, 'diagnose');
      store.save(current);
      cursor.record(current, entry);
      traceOffline(current, 'teacher_model_unavailable_fallback', 0);
      return { ok: true as const, ...cursor.keypoints(current) };
    });
  }

  return { unavailableActions, answer };
}
