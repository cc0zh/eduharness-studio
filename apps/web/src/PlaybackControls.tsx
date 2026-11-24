import type { Action } from '@eduharness-studio/engine';
import { Pause, Play, Send, SkipForward, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { cn } from '@/lib/utils';
import { EvidenceLink } from './EvidenceLink';
import { LessonAskCard } from './LessonAskCard';
import type { useLessonPlayback } from './useLessonPlayback';

export function PlaybackControls({
  playback,
  caption,
  ask,
  captionEvidence,
}: {
  playback: ReturnType<typeof useLessonPlayback>;
  caption: string;
  ask?: Extract<Action, { type: 'ask' }>;
  captionEvidence?: {
    number?: number;
    selected: boolean;
    contextual: boolean;
    select: (number: number) => void;
    clear: () => void;
  };
}) {
  const [interruption, setInterruption] = useState('');
  const status =
    playback.end === 'done'
      ? '本课演播完成'
      : playback.end === 'closed'
        ? '演播已结束'
        : playback.busy
          ? '正在处理…'
          : playback.starting
            ? '正在连接课堂'
            : ask
              ? '等待作答'
              : playback.paused
                ? '已暂停'
                : '正在讲解';

  async function interrupt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await playback.interrupt(interruption)) {
      setInterruption((draft) => (draft === interruption ? '' : draft));
    }
  }

  return (
    <div
      className={cn(
        'shrink-0 px-3 pt-1 pb-3 sm:px-7 sm:pb-4',
        ask && 'max-h-[75%] overflow-y-auto overscroll-contain',
      )}
    >
      <section
        aria-label="课堂播放控制"
        className="mx-auto max-w-[56rem] overflow-hidden rounded-[14px] border border-ink/10 bg-surface shadow-[0_4px_20px_rgba(26,25,23,0.045),0_1px_2px_rgba(26,25,23,0.02)]"
      >
        <div className="px-4 py-3 sm:px-5 sm:py-3.5">
          {playback.error && (
            <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft/75 px-3 py-1.5 text-xs text-accent">
              <p role="alert">{playback.error}</p>
              {playback.retrySave && (
                <button
                  type="button"
                  onClick={playback.retrySave}
                  className="cursor-pointer rounded-md border border-accent/35 px-2 py-0.5 font-medium hover:bg-accent-soft"
                >
                  重试保存
                </button>
              )}
            </div>
          )}

          {ask ? (
            <LessonAskCard
              key={ask.step_id}
              ask={ask}
              text={playback.answerText}
              canAnswer={playback.canAnswer}
              busy={playback.busy}
              setText={playback.setAnswerText}
              submit={playback.submitAnswer}
            />
          ) : (
            <div className="space-y-2.5">
              {/* 上行：全宽舒展的导师口语旁白 */}
              <div
                data-caption-evidence={captionEvidence?.selected || undefined}
                className="rounded-lg transition-colors data-[caption-evidence=true]:bg-accent-soft/75 data-[caption-evidence=true]:px-3 data-[caption-evidence=true]:py-2"
                aria-live="polite"
              >
                {(captionEvidence?.selected || captionEvidence?.number !== undefined) && (
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <p className="text-[11px] font-medium text-accent">
                      {captionEvidence.selected
                        ? captionEvidence.contextual
                          ? '关联字幕'
                          : '证据字幕'
                        : '课堂字幕'}
                    </p>
                    {captionEvidence.number !== undefined && (
                      <EvidenceLink
                        number={captionEvidence.number}
                        onClick={() => {
                          if (captionEvidence.number !== undefined) {
                            captionEvidence.select(captionEvidence.number);
                          }
                        }}
                      />
                    )}
                    {captionEvidence.selected && (
                      <button
                        type="button"
                        aria-label="返回实时字幕"
                        title="返回实时字幕"
                        onClick={captionEvidence.clear}
                        className="ml-auto grid size-5 cursor-pointer place-items-center rounded-md text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-ink"
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
                <p data-subtitle="true" className="text-[14.5px] leading-[1.72] text-ink">
                  {caption}
                </p>
              </div>

              {/* 下行：柔和微圆角节拍控件 + 轻量插话入口 */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border-faint/80 pt-2.5">
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={playback.paused ? '继续' : '暂停'}
                    onClick={playback.togglePaused}
                    disabled={!playback.canToggle}
                    className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-medium text-surface transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {playback.paused ? (
                      <Play aria-hidden="true" className="size-3" />
                    ) : (
                      <Pause aria-hidden="true" className="size-3" />
                    )}
                    {playback.paused ? '继续' : '暂停'}
                  </button>
                  <button
                    type="button"
                    aria-label="单拍前进 Step"
                    onClick={playback.stepForward}
                    disabled={!playback.canStep}
                    className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-ink/12 bg-canvas/70 px-2.5 text-xs font-medium text-ink-secondary transition-colors hover:border-ink/35 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <SkipForward aria-hidden="true" className="size-3" />
                    单拍 Step
                  </button>
                  <span className="pl-1.5 text-xs text-muted">{status}</span>
                </div>

                <form
                  onSubmit={interrupt}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-canvas/75 px-3 py-1 transition-colors focus-within:bg-canvas focus-within:ring-1 focus-within:ring-ink/20 sm:max-w-xs"
                >
                  <input
                    aria-label="打断插话"
                    placeholder="有疑问？随时插话…"
                    maxLength={1000}
                    value={interruption}
                    onChange={(event) => setInterruption(event.target.value)}
                    disabled={!playback.canInterrupt}
                    className="min-w-0 flex-1 bg-transparent py-0.5 text-xs text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!playback.canInterrupt || !interruption.trim()}
                    className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs font-medium text-ink-secondary transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Send aria-hidden="true" className="size-3" />
                    插话
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
