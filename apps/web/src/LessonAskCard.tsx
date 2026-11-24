import type { Action } from '@eduharness-studio/engine';
import { PenLine, Send } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function LessonAskCard({
  ask,
  text,
  canAnswer,
  busy,
  setText,
  submit,
}: {
  ask: Extract<Action, { type: 'ask' }>;
  text: string;
  canAnswer: boolean;
  busy: boolean;
  setText: (text: string) => void;
  submit: (optionId?: string) => Promise<void>;
}) {
  const options = ask.mode === 'choice' ? ask.options : undefined;
  const description = ask.hint ? 'ask-prompt ask-hint' : 'ask-prompt';
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<HTMLElement>(null);

  // The ask appears before its progress write settles. On retry, restore the last answer control.
  useEffect(() => {
    if (!canAnswer || (lastFocused.current && document.activeElement !== document.body)) return;
    (lastFocused.current ?? firstOptionRef.current ?? textareaRef.current)?.focus();
  }, [canAnswer]);

  return (
    <section
      data-ask-card="true"
      aria-labelledby="ask-title"
      className="animate-paper-reveal space-y-3"
      onFocus={(event) => {
        lastFocused.current = event.target;
      }}
    >
      <div className="space-y-1 [overflow-wrap:anywhere]">
        <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
          <PenLine className="size-3.5" aria-hidden="true" />
          <h2 id="ask-title">停下来想一想 · 随堂检验</h2>
          <span role="status" className="ml-auto text-muted">
            {busy && '正在处理…'}
          </span>
        </div>
        <p id="ask-prompt" className="font-serif text-[15px] leading-relaxed text-ink">
          {ask.prompt}
        </p>
        {ask.hint && (
          <p id="ask-hint" className="text-xs leading-relaxed text-muted">
            提示：{ask.hint}
          </p>
        )}
      </div>
      {options && (
        <fieldset disabled={!canAnswer} aria-describedby={description} className="min-w-0">
          <legend className="mb-1.5 text-xs text-ink-secondary">点选一个回答即可提交</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {options.map(({ id, label }, index) => (
              <button
                key={id}
                ref={index === 0 ? firstOptionRef : undefined}
                type="button"
                onClick={() => void submit(id)}
                className="min-h-10 min-w-0 cursor-pointer rounded-lg border border-ink/15 bg-canvas/70 px-3 py-1.5 text-left text-[13px] leading-relaxed text-ink transition-colors [overflow-wrap:anywhere] hover:border-ink/40 hover:bg-surface-recessed focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-45"
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
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
          aria-describedby={description}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={!canAnswer}
          rows={options ? 1 : 2}
          maxLength={1000}
          placeholder={options ? '也可以用自己的话回答…' : '用自己的话写下思路…'}
          className="min-h-11 min-w-0 flex-1 resize-none rounded-[10px] border border-ink/12 bg-canvas/80 px-3.5 py-2.5 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint transition-colors focus:border-ink/35 focus:bg-surface"
        />
        <button
          type="submit"
          disabled={!canAnswer || !text.trim()}
          className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] bg-ink px-4 text-xs font-medium text-surface transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Send aria-hidden="true" className="size-3.5" />
          提交回答
        </button>
      </form>
    </section>
  );
}
