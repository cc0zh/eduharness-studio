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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { coursePath, errorMessage, request } from '@/lib/courses';

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
    <section
      aria-labelledby="topic-title"
      className="rounded-2xl border border-primary/25 bg-surface p-5 shadow-sm sm:p-7"
    >
      <h2 id="topic-title" className="text-xl font-bold">
        按主题建课
      </h2>
      <p className="mt-1 text-sm text-muted">
        根据你的起点和目标离线生成课程蓝图，不连接外部模型。
      </p>
      <form className="mt-5" onSubmit={(event) => void submit(event)}>
        <div hidden={step !== null}>
          <label htmlFor="topic" className="mb-2 block text-sm font-semibold">
            学习主题
          </label>
          <Input
            ref={topicInput}
            id="topic"
            placeholder="例如：概率的直觉"
            value={topic}
            maxLength={INTAKE_LIMITS.topic}
            disabled={step !== null || pending}
            className="h-11"
            onChange={(event) => changeTopic(event.target.value)}
          />
          <p className="mt-3 text-sm text-muted">摸底基础 → 明确目标 → 生成课程蓝图</p>
        </div>

        {step && (
          <div className="rounded-xl border border-primary/15 bg-primary-soft/20 p-4 sm:p-5">
            <h3
              ref={stepHeading}
              tabIndex={-1}
              className="flex flex-wrap items-center gap-2 outline-none"
            >
              <Badge>轻调研 · 第 {second ? 2 : 1} / 2 步</Badge>
              <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
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
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-amber-800">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {step && (
            <Button variant="ghost" onClick={back} disabled={pending}>
              上一步
            </Button>
          )}
          <Button type="submit" disabled={!canSubmit || pending} className="h-10 px-4">
            {pending ? '正在处理…' : second ? '生成课程蓝图' : first ? '下一步' : '开始轻调研'}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </form>
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
    <fieldset disabled={disabled} className="mt-4 min-w-0">
      <legend className="text-base font-bold">{step.prompt}</legend>
      <div className="mb-4 mt-3 flex flex-wrap gap-2">
        {step.options.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded-full border border-border bg-surface px-3 py-2 text-sm font-medium hover:border-primary/50 has-checked:border-primary has-checked:bg-primary has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-primary/60 has-focus-visible:ring-offset-2"
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
      <label htmlFor={noteId} className="mb-2 block text-sm font-medium">
        {step.noteLabel} <span className="font-normal text-muted">（选填）</span>
      </label>
      <Input
        id={noteId}
        placeholder={step.noteExample}
        maxLength={INTAKE_LIMITS.note}
        value={note}
        onChange={(event) => changeNote(event.target.value)}
      />
    </fieldset>
  );
}
