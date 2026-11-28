import type { LessonRecord } from '@eduharness-studio/engine';
import {
  type Action,
  projectKeypointProgress,
  validateLessonScript,
} from '@eduharness-studio/engine';
import {
  compileTeacherTurn,
  effortSignal,
  type TeacherTurnContext,
  teacherBeatBudgetReason,
  teacherTurnPolicy,
} from '@eduharness-studio/engine/teacher';
import type { SessionCursor } from './session-cursor.js';
import type { StoredSession, sessionDatabase } from './session-db.js';
import { sameSession, type TeacherOperationLock, teacherContext } from './session-teacher.js';

type Store = ReturnType<typeof sessionDatabase>;

export function createTeacherFallback(
  store: Store,
  cursor: SessionCursor,
  traceOffline: (session: StoredSession, name: string, durationMs: number) => void,
) {
  function unavailableTurn(
    context: TeacherTurnContext,
    markUnverified: boolean,
    firstLowEffort = false,
  ) {
    const { played, progress } = context;
    const { pacing } = teacherTurnPolicy(context);
    if (pacing.close) return compileTeacherTurn(context);
    const { keypoints, currentIndex } = projectKeypointProgress(context.keypoints, played);
    const current = keypoints[currentIndex];
    if (!current) throw new Error('Missing active keypoint in teacher fallback');
    if (current.status !== 'active') {
      return compileTeacherTurn(context, {
        diagnosis: { status: 'clarifying', summary: '要点结果已确认。', strategy: '离线收尾。' },
        panels: [{ title: '课堂回顾', content: '保留已经确认的要点。这节课先到这里。' }],
      });
    }
    const next = keypoints[currentIndex + 1];
    let step = Math.max(progress.highWater, played.at(-1)?.step_id ?? 0);
    const id = `offline-${step + 1}`;
    const actions: Action[] = [];
    const speak = (text: string) => actions.push({ type: 'speak', step_id: ++step, text });
    const reinforce = (text: string) => {
      if (pacing.teachingBeats >= 4) speak(text);
    };
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
      reinforce(`先看「${current.title.slice(0, 48)}」里的两个关键条件。`);
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
      reinforce(`换到「${next.title.slice(0, 48)}」，先观察一个具体情境。`);
      ask(next, `${id}-ask`);
    } else if (markUnverified) {
      speak('先保留刚才的回答。这个要点暂不记作掌握，我们再检查白板上的具体条件。');
      board(current, id);
      reinforce(`回看「${current.title.slice(0, 48)}」：先辨认它依赖的条件。`);
      unverified();
    } else {
      speak('沿用白板上已经确认的内容，再换一个具体例子。');
      board(current, id);
      reinforce(`从「${current.title.slice(0, 48)}」的一个例子重新开始。`);
      ask(current, `${id}-ask`);
    }
    // An unavailable model must not bypass the same closure reserve applied to live scenes.
    const overBudget = teacherBeatBudgetReason(played.length, actions, keypoints);
    if (overBudget) return { ok: false as const, reasons: [overBudget] };
    return {
      ok: true as const,
      actions,
      keypoints,
      initialState: 'diagnose' as const,
      progress: {
        ...progress,
        highWater: step,
        lowEffortStreak: firstLowEffort ? 1 : progress.lowEffortStreak,
      },
    };
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
      const context = teacherContext(
        cursor,
        current,
        { ...entry, choice: optionId !== undefined },
        progress,
      );
      const signal = effortSignal(context.input);
      const firstLowEffort = signal === 'low' && progress.lowEffortStreak === 0;
      const plan = unavailableTurn(context, !firstLowEffort, firstLowEffort);
      if (!plan.ok) return { error: 'teacher_turn_failed' } as const;
      const script = {
        keypoints: plan.keypoints,
        actions: [...context.played, ...plan.actions],
      };
      if (!validateLessonScript(script)) return { error: 'teacher_turn_failed' } as const;
      current.queue.script = script;
      current.queue.askStep = null;
      current.queue.teacher = plan.progress;
      cursor.transition(current, plan.initialState);
      store.save(current);
      cursor.record(current, entry);
      traceOffline(current, 'teacher_model_unavailable_fallback', 0);
      return { ok: true as const, ...cursor.keypoints(current) };
    });
  }

  return { unavailableTurn, answer };
}
