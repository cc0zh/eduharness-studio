import { type LessonMetadata, projectKeypointProgress } from '@eduharness-studio/engine';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRead } from '@/lib/courses';
import { BoardStage } from './BoardStage';
import { LessonAskCard } from './LessonAskCard';
import { LessonProgress } from './LessonProgress';
import {
  type BoardPage,
  latestCaption,
  projectBoard,
  shouldFollowLatestPage,
} from './lesson-playback';
import { readPagePreference, writePagePreference } from './lesson-view-preferences';
import { PlaybackControls } from './PlaybackControls';
import { RecordSheet } from './RecordSheet';
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
  const { sessionId } = playback;
  const progress = projectKeypointProgress(keypoints, playback.played);
  const ask = playback.played.find(
    ({ type, step_id }) => type === 'ask' && step_id === playback.askStep,
  );
  const lastAction = playback.played.at(-1);

  return (
    <div
      className="mx-auto max-w-7xl px-4 pb-52 pt-5 sm:px-7 sm:pt-7"
      data-session-id={sessionId}
      data-generation={playback.generation}
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
          <div className="flex flex-wrap items-center gap-2">
            <RecordSheet key={sessionId} records={playback.records} />
            <Button
              variant="ghost"
              disabled={!playback.canRestart}
              onClick={() => void playback.restart()}
            >
              <RotateCcw aria-hidden="true" />
              重新开始本课
            </Button>
          </div>
        </div>
        <div className="mt-4">
          <LessonProgress keypoints={progress.keypoints} currentIndex={progress.currentIndex} />
        </div>
      </section>

      <div className="mt-5">
        {sessionId ? (
          <SessionBoard
            key={sessionId}
            sessionId={sessionId}
            pages={projectBoard(playback.played)}
            playedStep={lastAction?.step_id ?? 0}
          />
        ) : !playback.end ? (
          <p role="status" className="px-3 text-sm text-muted">
            正在恢复本课白板…
          </p>
        ) : null}
      </div>

      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-6xl flex-col gap-2 sm:inset-x-6">
        {ask?.type === 'ask' && (
          <LessonAskCard
            ask={ask}
            text={playback.answerText}
            canAnswer={playback.canAnswer}
            setText={playback.setAnswerText}
            submit={playback.submitAnswer}
          />
        )}
        <PlaybackControls
          key={sessionId}
          playback={playback}
          caption={latestCaption(playback.played)}
        />
      </div>
      <span className="sr-only" aria-live="polite">
        {progress.keypoints.filter(({ status }) => status === 'completed').length}/
        {progress.keypoints.length} 个要点已过关
      </span>
    </div>
  );
}

function SessionBoard({
  sessionId,
  pages,
  playedStep,
}: {
  sessionId: string;
  pages: BoardPage[];
  playedStep: number;
}) {
  const [pinned, setPinned] = useState(() => readPagePreference(sessionId));
  const latest = pages.length - 1;
  const pinnedIndex = pages.findIndex(({ id }) => id === pinned?.id);
  const pageIndex =
    pinnedIndex >= 0 && !shouldFollowLatestPage(pinned, playedStep) ? pinnedIndex : latest;
  return (
    <BoardStage
      pages={pages}
      pageIndex={pageIndex}
      onPageChange={(index) => {
        const page = index === latest ? null : { id: pages[index].id, step: playedStep };
        writePagePreference(sessionId, page);
        setPinned(page);
      }}
    />
  );
}
