import type { Action } from '@eduharness-studio/engine';
import { PenLine, Send } from 'lucide-react';
import { useEffect, useRef } from 'react';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 遇 ask 停顿时自动聚焦答题框，实现与底部棉纸台原地变形的焦点唯一性
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <section
      data-ask-card="true"
      aria-labelledby="ask-title"
      className="animate-paper-reveal space-y-3"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
          <PenLine className="size-3.5" aria-hidden="true" />
          <h2 id="ask-title">停下来想一想 · 随堂检验</h2>
        </div>
        <p className="font-serif text-[15px] leading-relaxed text-ink">{ask.prompt}</p>
        {ask.hint && <p className="text-xs leading-relaxed text-muted">提示：{ask.hint}</p>}
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="class-answer" className="sr-only">
          写下你的回答
        </label>
        <textarea
          ref={textareaRef}
          id="class-answer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="用自己的话写下思路…"
          className="min-h-11 min-w-0 flex-1 resize-none rounded-[10px] border border-ink/12 bg-canvas/80 px-3.5 py-2.5 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint transition-colors focus:border-ink/35 focus:bg-surface"
        />
        <button
          type="submit"
          disabled={!canAnswer}
          className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] bg-ink px-4 text-xs font-medium text-surface transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Send aria-hidden="true" className="size-3.5" />
          提交回答
        </button>
      </form>
    </section>
  );
}
