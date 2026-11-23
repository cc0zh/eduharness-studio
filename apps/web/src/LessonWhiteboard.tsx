import { type LessonMetadata, projectKeypointProgress } from '@eduharness-studio/engine';
import { Pause, Play, Send, SkipForward } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useRead } from '@/lib/courses';
import { BoardStage } from './BoardStage';
import { LessonProgress } from './LessonProgress';
import { latestCaption, projectBoard } from './lesson-playback';
import { useLessonPlayback } from './useLessonPlayback';

type LessonProps = {
  path: string;
  title: string;
  summary: string;
};

export function LessonWhiteboard(props: LessonProps) {
  const { data: lesson, error: keypointError, retry } = useRead<LessonMetadata>(props.path);
  if (!lesson) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-12">
        {keypointError ? (
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <p role="alert" className="text-sm text-amber-800">
              {keypointError}
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 rounded-lg border px-3 py-2 text-sm font-semibold text-primary"
            >
              重新加载
            </button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted">
            正在准备本课要点…
          </p>
        )}
      </div>
    );
  }
  return <PlayingLesson {...props} keypoints={lesson.keypoints} />;
}

function PlayingLesson({ path, title, summary, keypoints }: LessonProps & LessonMetadata) {
  const playback = useLessonPlayback(path);
  const [pinnedPage, setPinnedPage] = useState<number>();
  const progress = projectKeypointProgress(keypoints, playback.played);
  const ask = playback.played.find(
    ({ type, step_id }) => type === 'ask' && step_id === playback.askStep,
  );
  const pages = projectBoard(playback.played);
  const latestPage = pages.length - 1;
  const caption = latestCaption(playback.played);
  const status =
    playback.end === 'done'
      ? '本课演播完成'
      : playback.end === 'closed'
        ? '演播已结束'
        : playback.starting
          ? '正在准备课堂'
          : ask
            ? '等待你的回答'
            : playback.paused
              ? '已暂停'
              : '正在讲解';
  const lastAction = playback.played.at(-1);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void playback.submitAnswer();
  }

  return (
    <div
      className="mx-auto max-w-7xl px-4 pb-44 pt-5 sm:px-7 sm:pt-7"
      data-played-step={lastAction?.step_id ?? 0}
      data-played-action={lastAction?.type ?? 'waiting'}
    >
      <section
        aria-labelledby="lesson-title"
        className="rounded-3xl border border-primary/10 bg-white/85 px-4 py-4 shadow-sm sm:px-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-primary">
              Eduharness课堂 · 一对一白板课
            </p>
            <h1
              id="lesson-title"
              className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl [overflow-wrap:anywhere]"
            >
              {title}
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{summary}</p>
          </div>
          <div className="max-w-full shrink-0 sm:max-w-[58%]">
            <LessonProgress keypoints={progress.keypoints} currentIndex={progress.currentIndex} />
          </div>
        </div>
      </section>

      <div className="mt-5">
        <BoardStage
          pages={pages}
          pageIndex={Math.min(pinnedPage ?? latestPage, latestPage)}
          onPageChange={(index) => setPinnedPage(index === latestPage ? undefined : index)}
        />
      </div>

      {ask && ask.type === 'ask' && (
        <aside
          data-ask-card="true"
          aria-labelledby="ask-title"
          className="fixed inset-x-4 bottom-28 z-40 mx-auto max-w-2xl rounded-2xl border border-[#E4C37A] bg-white p-4 shadow-[0_18px_60px_-20px_rgba(80,61,21,0.38)] sm:bottom-28 sm:p-5"
        >
          <div className="mb-3 flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-[#FFF2D6] font-bold text-[#91621D]"
            >
              问
            </span>
            <div className="min-w-0">
              <h2 id="ask-title" className="text-sm font-bold text-ink">
                停下来想一想
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{ask.prompt}</p>
              {ask.hint && (
                <p className="mt-1.5 text-xs leading-relaxed text-muted">提示：{ask.hint}</p>
              )}
            </div>
          </div>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
            <label htmlFor="class-answer" className="sr-only">
              写下你的回答
            </label>
            <textarea
              id="class-answer"
              value={playback.answerText}
              onChange={(event) => playback.setAnswerText(event.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="用自己的话写下思路…"
              className="min-h-12 min-w-0 flex-1 resize-y rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              disabled={!playback.canAnswer}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send aria-hidden="true" className="size-4" />
              提交回答
            </button>
          </form>
        </aside>
      )}

      <section
        aria-label="课堂播放控制"
        className="fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-6xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_16px_56px_-24px_rgba(15,23,42,0.44)] backdrop-blur-xl sm:inset-x-6 sm:flex-row sm:items-center sm:gap-5 sm:px-5"
      >
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-[11px] font-semibold tracking-wide text-primary">课堂字幕</p>
          <p
            data-subtitle="true"
            className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-slate-700"
          >
            {caption}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <span className="mr-auto hidden text-xs text-muted sm:block">{status}</span>
          <button
            type="button"
            aria-label={playback.paused ? '继续' : '暂停'}
            onClick={playback.togglePaused}
            disabled={!playback.canToggle}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold text-ink hover:border-primary/40 hover:bg-primary-soft/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {playback.paused ? (
              <Play aria-hidden="true" className="size-4" />
            ) : (
              <Pause aria-hidden="true" className="size-4" />
            )}
            {playback.paused ? '继续' : '暂停'}
          </button>
          <button
            type="button"
            aria-label="单拍前进 Step"
            onClick={playback.stepForward}
            disabled={!playback.canStep}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SkipForward aria-hidden="true" className="size-4" />
            单拍 Step
          </button>
        </div>
        {playback.error && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-900 sm:absolute sm:bottom-full sm:right-0 sm:mb-2 sm:rounded-xl sm:bg-white sm:p-2 sm:shadow-md">
            <p role="alert">{playback.error}</p>
            {playback.retrySave && (
              <button
                type="button"
                onClick={playback.retrySave}
                className="rounded-lg border border-amber-300 px-2 py-1.5 font-semibold hover:bg-amber-50"
              >
                重试保存
              </button>
            )}
          </div>
        )}
      </section>
      <span className="sr-only" aria-live="polite">
        {progress.keypoints.filter(({ status }) => status === 'completed').length}/
        {progress.keypoints.length} 个要点已过关
      </span>
    </div>
  );
}
