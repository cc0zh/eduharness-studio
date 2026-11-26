import {
  type CourseBlueprint,
  type Foundation,
  type FoundationStep,
  type GoalStep,
  INTAKE_LIMITS,
  type IntakeAnswers,
  type IntakeNext,
} from '@eduharness-studio/engine';
import { ArrowRight } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { coursePath, errorMessage, request } from '@/lib/courses';

const QUICK_TOPICS = ['梯度下降与学习率直觉', 'HTTPS 握手与非对称加密', '熵与交叉熵的本质'];

export function TopicIntake() {
  const [topic, setTopic] = useState('');
  const [first, setFirst] = useState<FoundationStep | null>(null);
  const [second, setSecond] = useState<GoalStep | null>(null);
  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [goal, setGoal] = useState<IntakeAnswers['goal'] | null>(null);
  const [foundationNote, setFoundationNote] = useState('');
  const [goalNote, setGoalNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const topicInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const step = second ?? first;
  const canSubmit = second ? goal !== null : first ? foundation !== null : topic.trim() !== '';

  useEffect(() => {
    if (step) {
      started.current = true;
      stepHeading.current?.focus();
    } else if (started.current) {
      topicInput.current?.focus();
    }
  }, [step]);

  function back() {
    setError('');
    if (second) {
      setSecond(null);
    } else {
      setFirst(null);
    }
  }

  function changeTopic(value: string) {
    if (value.trim() !== topic.trim()) {
      setFoundation(null);
      setGoal(null);
      setFoundationNote('');
      setGoalNote('');
    }
    setTopic(value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    setPending(true);
    setError('');
    try {
      if (!first) {
        const start = await request<FoundationStep>('/intake/start', { topic: topic.trim() });
        setFirst(start);
        setTopic(start.topic);
      } else if (foundation) {
        const draft: IntakeNext = { topic: first.topic, foundation, foundationNote };
        if (!second) {
          setSecond(await request<GoalStep>('/intake/next', draft));
        } else if (goal) {
          const answers: IntakeAnswers = { ...draft, goal, goalNote };
          const { id } = await request<CourseBlueprint>('/intake/generate', answers);
          window.location.assign(coursePath(id));
          return;
        }
      }
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
    setPending(false);
  }

  return (
    <section aria-labelledby="topic-title" className="text-left">
      <h2 id="topic-title" className="sr-only">
        按主题建课
      </h2>
      <form
        onSubmit={(event) => void submit(event)}
        className="overflow-hidden rounded-[14px] border border-ink/12 bg-surface shadow-[0_2px_14px_rgba(26,25,23,0.035),0_1px_2px_rgba(26,25,23,0.02)] transition-[border-color,box-shadow] focus-within:border-ink/30 focus-within:shadow-[0_6px_24px_rgba(26,25,23,0.06)]"
      >
        <div hidden={step !== null} className="flex items-center gap-3 py-2.5 pr-2.5 pl-5">
          <label htmlFor="topic" className="sr-only">
            学习主题
          </label>
          <input
            ref={topicInput}
            id="topic"
            type="text"
            aria-describedby={step ? undefined : 'offline-intake-note'}
            placeholder="输入你想彻底搞懂的主题，例如：线性插值、傅里叶变换…"
            value={topic}
            maxLength={INTAKE_LIMITS.topic}
            disabled={step !== null || pending}
            onChange={(event) => changeTopic(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!canSubmit || pending}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[9px] bg-ink px-4 py-2 text-[13px] font-medium text-surface transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span>{pending ? '准备中…' : '开始轻调研'}</span>
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        </div>

        {step && (
          <div className="bg-canvas/70 px-5 py-5">
            <h3
              ref={stepHeading}
              tabIndex={-1}
              className="flex flex-wrap items-baseline gap-2.5 outline-none"
            >
              <span className="font-mono text-[11px] font-medium text-accent">
                轻调研 · 第 {second ? 2 : 1} / 2 步
              </span>
              <span className="min-w-0 font-serif text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">
                {first?.topic}
              </span>
            </h3>
            {second ? (
              <Question
                name="goal"
                step={second}
                value={goal}
                note={goalNote}
                choose={setGoal}
                changeNote={setGoalNote}
                disabled={pending}
              />
            ) : (
              first && (
                <Question
                  name="foundation"
                  step={first}
                  value={foundation}
                  note={foundationNote}
                  choose={setFoundation}
                  changeNote={setFoundationNote}
                  disabled={pending}
                />
              )
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border-faint pt-3.5">
              <Button variant="ghost" size="sm" onClick={back} disabled={pending}>
                上一步
              </Button>
              <button
                type="submit"
                disabled={!canSubmit || pending}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-surface transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span>{pending ? '正在生成…' : second ? '生成课程蓝图' : '下一步'}</span>
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="border-t border-border-faint px-5 py-2.5 text-xs text-accent">
            {error}
          </p>
        )}
      </form>

      {!step && (
        <div className="mt-3 space-y-2 text-xs text-muted">
          <p id="offline-intake-note" className="text-center leading-relaxed">
            不填 Key 也能上精选示范课。离线自由建课只提供学习路线和通用课堂样例，不提供主题专讲。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
            <span>试试主题：</span>
            {QUICK_TOPICS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  changeTopic(item);
                  topicInput.current?.focus();
                }}
                className="cursor-pointer border-b border-border pb-px text-ink-secondary transition-colors hover:border-accent hover:text-accent"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Question<Value extends string>({
  name,
  step,
  value,
  note,
  choose,
  changeNote,
  disabled,
}: {
  name: string;
  step: {
    prompt: string;
    options: { value: Value; label: string }[];
    noteLabel: string;
    noteExample: string;
  };
  value: Value | null;
  note: string;
  choose: (choice: Value) => void;
  changeNote: (note: string) => void;
  disabled: boolean;
}) {
  const noteId = `${name}-note`;
  return (
    <fieldset disabled={disabled} className="mt-3.5 min-w-0">
      <legend className="text-[13.5px] font-medium text-ink">{step.prompt}</legend>
      <div className="mt-3 mb-4 flex flex-wrap gap-2">
        {step.options.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded-lg border border-ink/12 bg-surface px-3.5 py-1.5 text-[13px] text-ink-secondary transition-colors hover:border-ink/40 hover:text-ink has-checked:border-ink has-checked:bg-ink has-checked:text-surface has-focus-visible:ring-2 has-focus-visible:ring-ink/30"
          >
            <input
              className="sr-only"
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => choose(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <label htmlFor={noteId} className="mb-1.5 block text-xs text-ink-secondary">
        {step.noteLabel} <span className="text-muted">（选填）</span>
      </label>
      <Input
        id={noteId}
        placeholder={step.noteExample}
        maxLength={INTAKE_LIMITS.note}
        value={note}
        onChange={(event) => changeNote(event.target.value)}
        className="rounded-lg border-ink/12 bg-surface"
      />
    </fieldset>
  );
}
