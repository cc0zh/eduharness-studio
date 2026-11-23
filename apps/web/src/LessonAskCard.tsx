import type { Action } from '@eduharness-studio/engine';
import { Send } from 'lucide-react';

export function LessonAskCard({
  ask,
  text,
  canAnswer,
  setText,
  submit,
}: {
  ask: Extract<Action, { type: 'ask' }>;
  text: string;
  canAnswer: boolean;
  setText: (text: string) => void;
  submit: () => Promise<void>;
}) {
  return (
    <aside
      data-ask-card="true"
      aria-labelledby="ask-title"
      className="pointer-events-auto mx-auto w-full max-w-2xl rounded-2xl border border-[#E4C37A] bg-white p-4 shadow-[0_18px_60px_-20px_rgba(80,61,21,0.38)] sm:p-5"
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
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="class-answer" className="sr-only">
          写下你的回答
        </label>
        <textarea
          id="class-answer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="用自己的话写下思路…"
          className="min-h-12 min-w-0 flex-1 resize-y rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="submit"
          disabled={!canAnswer}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send aria-hidden="true" className="size-4" />
          提交回答
        </button>
      </form>
    </aside>
  );
}
