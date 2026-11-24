import {
  type LessonMetadata,
  type PlayedDialogue,
  projectKeypointProgress,
  projectPlayedDialogue,
} from '@eduharness-studio/engine';
import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRead } from '@/lib/courses';
import { cn } from '@/lib/utils';
import { BoardStage } from './BoardStage';
import { LessonAskCard } from './LessonAskCard';
import { LessonProgress } from './LessonProgress';
import {
  type EvidenceTarget,
  type EvidenceView,
  locateEvidence,
  teacherNumbers,
} from './lesson-evidence';
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
import { XRayDrawer } from './XRayDrawer';

type LessonProps = {
  path: string;
  title: string;
  summary: string;
  xrayOpen: boolean;
  closeXray: () => void;
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

function PlayingLesson({
  path,
  title,
  summary,
  keypoints,
  xrayOpen,
  closeXray,
}: LessonProps & LessonMetadata) {
  const playback = useLessonPlayback(path);
  const { sessionId } = playback;
  const [selection, setSelection] = useState<{ sessionId: string; target: EvidenceTarget }>();
  useEffect(() => {
    if (!xrayOpen) setSelection(undefined);
  }, [xrayOpen]);
  const target = xrayOpen && selection?.sessionId === sessionId ? selection?.target : undefined;
  const pages = projectBoard(playback.played);
  const dialogue = xrayOpen ? projectPlayedDialogue(playback.played, playback.records) : undefined;
  function select(number: number, source: PlayedDialogue, preferredStep?: number) {
    if (!sessionId) return;
    const target = locateEvidence(source, number, playback.played, pages, preferredStep);
    if (target) setSelection({ sessionId, target });
  }
  const evidence: EvidenceView | undefined = dialogue
    ? {
        numbersByStep: teacherNumbers(dialogue.turns),
        target,
        select: (number, preferredStep) => select(number, dialogue, preferredStep),
      }
    : undefined;
  const progress = projectKeypointProgress(keypoints, playback.played);
  const ask = playback.played.find(
    ({ type, step_id }) => type === 'ask' && step_id === playback.askStep,
  );
  const askCard =
    ask?.type === 'ask' ? (
      <LessonAskCard
        ask={ask}
        text={playback.answerText}
        canAnswer={playback.canAnswer}
        setText={playback.setAnswerText}
        submit={playback.submitAnswer}
      />
    ) : null;
  const lastAction = playback.played.at(-1);
  const caption = target?.caption ?? latestCaption(playback.played);
  const activeCaptionNumber = caption ? evidence?.numbersByStep.get(caption.step_id) : undefined;

  return (
    <div
      className={cn(
        xrayOpen &&
          'flex h-[calc(100dvh-4rem-var(--lesson-xray-short-height))] min-w-0 flex-col lg:mr-[var(--lesson-xray-width)] lg:h-[calc(100dvh-4rem)]',
      )}
      data-session-id={sessionId}
      data-generation={playback.generation}
      data-played-step={lastAction?.step_id ?? 0}
      data-played-action={lastAction?.type ?? 'waiting'}
    >
      <div
        className={cn(xrayOpen && 'min-h-0 flex-1 overflow-y-auto overscroll-contain')}
        data-lesson-stage
      >
        <div
          className={cn('mx-auto max-w-7xl px-4 pt-5 sm:px-7 sm:pt-7', xrayOpen ? 'pb-5' : 'pb-52')}
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
                <RecordSheet
                  key={sessionId}
                  records={playback.records}
                  numbers={dialogue?.recordTurnNumbers}
                  evidence={evidence}
                />
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
            {xrayOpen && askCard && <div className="mb-4">{askCard}</div>}
            {sessionId ? (
              <SessionBoard
                key={sessionId}
                sessionId={sessionId}
                pages={pages}
                playedStep={lastAction?.step_id ?? 0}
                evidence={evidence}
                clearSelection={() => setSelection(undefined)}
              />
            ) : !playback.end ? (
              <p role="status" className="px-3 text-sm text-muted">
                正在恢复本课白板…
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className={cn(
          'pointer-events-none mx-auto flex max-w-6xl flex-col gap-2',
          xrayOpen
            ? 'z-30 w-full shrink-0 px-3 pb-3 sm:px-6'
            : 'fixed inset-x-3 bottom-3 z-30 sm:inset-x-6',
        )}
      >
        {!xrayOpen && askCard}
        <PlaybackControls
          key={sessionId}
          playback={playback}
          caption={caption?.text ?? '老师正在整理白板…'}
          captionEvidence={
            evidence && {
              number: activeCaptionNumber,
              selected: Boolean(target?.caption),
              contextual: target?.number !== activeCaptionNumber,
              select: (number) => evidence.select(number, caption?.step_id),
              clear: () => setSelection(undefined),
            }
          }
        />
      </div>
      {dialogue && (
        <XRayDrawer
          key={sessionId}
          playback={playback}
          dialogue={dialogue}
          onEvidence={select}
          onClose={closeXray}
        />
      )}
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
  evidence,
  clearSelection,
}: {
  sessionId: string;
  pages: BoardPage[];
  playedStep: number;
  evidence?: EvidenceView;
  clearSelection: () => void;
}) {
  const [pinned, setPinned] = useState(() => readPagePreference(sessionId));
  const latest = pages.length - 1;
  const pinnedIndex = pages.findIndex(({ id }) => id === pinned?.id);
  const pageIndex =
    evidence?.target?.pageIndex ??
    (pinnedIndex >= 0 && !shouldFollowLatestPage(pinned, playedStep) ? pinnedIndex : latest);
  return (
    <BoardStage
      pages={pages}
      pageIndex={pageIndex}
      evidence={evidence}
      onPageChange={(index) => {
        clearSelection();
        const page = index === latest ? null : { id: pages[index].id, step: playedStep };
        writePagePreference(sessionId, page);
        setPinned(page);
      }}
    />
  );
}
