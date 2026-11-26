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
import { EditorialSkeleton } from './EditorialSkeleton';
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
          <div className="space-y-3 border-l-2 border-accent pl-4">
            <p role="alert" className="text-sm text-accent">
              {keypointError}
            </p>
            <Button variant="outline" size="sm" onClick={retry}>
              重新加载
            </Button>
          </div>
        ) : (
          <EditorialSkeleton label="正在准备本课要点与讲义…" rows={3} />
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

  // 键盘快捷键：Space 暂停/继续，→ 单拍前进（输入框内自动忽略）
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      if (event.code === 'Space' && playback.canToggle && !(active instanceof HTMLButtonElement)) {
        event.preventDefault();
        playback.togglePaused();
      } else if (event.code === 'ArrowRight' && playback.canStep) {
        event.preventDefault();
        playback.stepForward();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playback]);

  const target = xrayOpen && selection?.sessionId === sessionId ? selection?.target : undefined;
  const pages = projectBoard(playback.played);
  const dialogue = xrayOpen ? projectPlayedDialogue(playback.played, playback.records) : undefined;
  function select(number: number, source: PlayedDialogue, preferredStep?: number) {
    if (!sessionId) return;
    const found = locateEvidence(source, number, playback.played, pages, preferredStep);
    if (found) setSelection({ sessionId, target: found });
  }
  const evidence: EvidenceView | undefined = dialogue
    ? {
        numbersByStep: teacherNumbers(dialogue.turns),
        target,
        select: (number, preferredStep) => select(number, dialogue, preferredStep),
      }
    : undefined;
  const progress = projectKeypointProgress(playback.keypoints ?? keypoints, playback.played);
  const unverifiedCount = progress.keypoints.filter(({ status }) => status === 'unverified').length;
  const askAction = playback.played.find(
    ({ type, step_id }) => type === 'ask' && step_id === playback.askStep,
  );
  const ask = askAction?.type === 'ask' ? askAction : undefined;
  const lastAction = playback.played.at(-1);
  const caption = target?.caption ?? latestCaption(playback.played);
  const activeCaptionNumber = caption ? evidence?.numbersByStep.get(caption.step_id) : undefined;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden',
        xrayOpen
          ? 'h-[calc(100dvh-3.5rem-var(--lesson-xray-short-height))] lg:mr-[var(--lesson-xray-width)] lg:h-[calc(100dvh-3.5rem)]'
          : 'h-[calc(100dvh-3.5rem)]',
      )}
      data-session-id={sessionId}
      data-generation={playback.generation}
      data-played-step={lastAction?.step_id ?? 0}
      data-played-action={lastAction?.type ?? 'waiting'}
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
        data-lesson-stage
      >
        <div className="mx-auto max-w-[84rem] px-4 pt-3.5 pb-6 sm:px-7 sm:pt-4">
          <section aria-labelledby="lesson-title" className="border-b border-border pb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h1
                  id="lesson-title"
                  className="font-serif text-lg font-semibold tracking-tight text-ink sm:text-[21px] [overflow-wrap:anywhere]"
                >
                  {title}
                </h1>
                <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-muted">{summary}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <RecordSheet
                  key={sessionId}
                  records={playback.records}
                  numbers={dialogue?.recordTurnNumbers}
                  evidence={evidence}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!playback.canRestart}
                  onClick={() => void playback.restart()}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  重新开始本课
                </Button>
              </div>
            </div>
            <div className="mt-2.5">
              <LessonProgress keypoints={progress.keypoints} currentIndex={progress.currentIndex} />
            </div>
          </section>

          <div className="mt-3.5">
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
              <EditorialSkeleton label="正在恢复本课白板…" rows={3} />
            ) : null}
          </div>
        </div>
      </div>

      <PlaybackControls
        key={`playback-${sessionId}`}
        playback={playback}
        caption={caption?.text ?? '老师正在整理白板…'}
        ask={ask}
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

      {dialogue && (
        <XRayDrawer
          key={`xray-${sessionId}`}
          playback={playback}
          dialogue={dialogue}
          onEvidence={select}
          onClose={closeXray}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {progress.keypoints.filter(({ status }) => status === 'completed').length}/
        {progress.keypoints.length} 个要点已过关
        {unverifiedCount > 0 && `，${unverifiedCount} 个未验证`}
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
