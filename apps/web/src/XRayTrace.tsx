import type { LessonTraceSpan, TeacherTurnTrace } from '@eduharness-studio/engine';

const triggerName: Record<TeacherTurnTrace['trigger'], string> = {
  opening: '开课',
  answer: '学生作答',
  interrupt: '打断续讲',
};

export function TeacherTurns({
  turns,
  playedStepIds,
}: {
  turns: TeacherTurnTrace[];
  playedStepIds: number[];
}) {
  const played = new Set(playedStepIds);
  return (
    <ol className="divide-y divide-border-faint text-xs leading-relaxed text-ink-secondary [overflow-wrap:anywhere]">
      {turns.map((turn, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: The session log is append-only. Rejected requests may share a step and trigger.
        <TeacherTurnRow key={index} turn={turn} played={played} />
      ))}
    </ol>
  );
}

function TeacherTurnRow({ turn, played }: { turn: TeacherTurnTrace; played: ReadonlySet<number> }) {
  const {
    generation,
    step_id,
    trigger,
    diagnosis,
    inserted,
    unverified,
    unverifiedStepId,
    guardrails,
    outcome,
  } = turn;
  return (
    <li data-teacher-turn={outcome} className="space-y-1 py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-medium text-ink">
          {triggerName[trigger]} · {outcome === 'accepted' ? '已采纳' : '已拦截'}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          G{generation} · 拍 {step_id}
        </span>
      </div>
      {diagnosis && (
        <>
          <p>
            <code className="mr-1.5 font-mono text-accent">{diagnosis.status}</code>
            {diagnosis.summary}
          </p>
          <p>教法 · {diagnosis.strategy}</p>
        </>
      )}
      {inserted && (
        <p>
          插入补课要点「{inserted.title}」 · <code>{inserted.id}</code> 排在{' '}
          <code>{inserted.before}</code> 之前
        </p>
      )}
      {unverified && (
        <p>
          {unverifiedStepId !== undefined && played.has(unverifiedStepId)
            ? '未验证'
            : '待上屏的未验证标记'}{' '}
          · <code>{unverified}</code>
        </p>
      )}
      {guardrails.length > 0 && (
        <div className="mt-1.5 border-l-2 border-accent/50 pl-2.5">
          <p className="font-medium text-accent">护栏拦截与重试</p>
          <ol className="space-y-1">
            {guardrails.map(({ attempt, reasons }) => (
              <li key={attempt} className="whitespace-pre-line">
                第 {attempt} 次 · {reasons.join('\n')}
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

const spanName: Record<string, string> = {
  lesson_script: '生成离线剧本',
  interrupt_continuation: '生成打断续讲',
  calc_verify: 'calc_verify · 安全计算',
};

export function TraceSpans({ spans }: { spans: LessonTraceSpan[] }) {
  return (
    <ol className="space-y-2 text-xs [overflow-wrap:anywhere]">
      {spans.map(({ kind, name, durationMs, generation, step_id, input, result }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Multiple tool calls and model attempts can share one step in this append-only log.
        <li key={index} data-span-kind={kind} className="space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="font-medium text-ink">{spanName[name] ?? name}</span>
            <span className="font-mono text-[11px] tabular-nums text-muted">
              {kind !== 'offline' && `${kind} · `}G{generation} · 拍 {step_id} ·{' '}
              {durationMs.toFixed(2)} ms
            </span>
          </div>
          {input !== undefined && <TraceField label="脱敏入参" value={input} />}
          {result !== undefined && <TraceField label="脱敏结果" value={result} />}
        </li>
      ))}
    </ol>
  );
}

function TraceField({ label, value }: { label: string; value: unknown }) {
  return (
    <p className="rounded bg-drawer px-2 py-1 text-[11.5px] leading-relaxed text-ink-secondary">
      {label} · <code>{JSON.stringify(value)}</code>
    </p>
  );
}
