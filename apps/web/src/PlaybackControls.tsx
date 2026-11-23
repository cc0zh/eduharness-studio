import { Pause, Play, Send, SkipForward } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { useLessonPlayback } from './useLessonPlayback';

export function PlaybackControls({
  playback,
  caption,
}: {
  playback: ReturnType<typeof useLessonPlayback>;
  caption: string;
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
            : playback.askStep !== null
              ? '等待你的回答'
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
    <section
      aria-label="课堂播放控制"
      className="pointer-events-auto rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_16px_56px_-24px_rgba(15,23,42,0.44)] backdrop-blur-xl sm:px-5"
    >
      {playback.error && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <p role="alert">{playback.error}</p>
          {playback.retrySave && (
            <button
              type="button"
              onClick={playback.retrySave}
              className="rounded-lg border border-amber-300 px-2 py-1.5 font-semibold hover:bg-amber-100"
            >
              重试保存
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:flex-nowrap">
        <div className="basis-full sm:min-w-0 sm:flex-1" aria-live="polite">
          <p className="text-[11px] font-semibold tracking-wide text-primary">课堂字幕</p>
          <p
            data-subtitle="true"
            className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-slate-700"
          >
            {caption}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-muted lg:block">{status}</span>
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
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold text-ink hover:bg-primary-soft/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SkipForward aria-hidden="true" className="size-4" />
            单拍 Step
          </button>
        </div>
        <form
          onSubmit={interrupt}
          className="flex min-w-0 flex-1 items-stretch gap-1.5 sm:max-w-80"
        >
          <input
            aria-label="打断插话"
            placeholder="有疑问？随时插话…"
            maxLength={1000}
            value={interruption}
            onChange={(event) => setInterruption(event.target.value)}
            disabled={!playback.canInterrupt}
            className="min-w-0 flex-1 rounded-xl border border-border bg-white px-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!playback.canInterrupt || !interruption.trim()}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send aria-hidden="true" className="size-4" />
            插话
          </button>
        </form>
      </div>
    </section>
  );
}
