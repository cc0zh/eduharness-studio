import type { PlayedDialogue, SessionTrace } from '@eduharness-studio/engine';
import { type ReactNode, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { errorMessage, request } from '@/lib/courses';
import { EvidenceLink } from './EvidenceLink';
import { sessionPath } from './lesson-session';
import type { useLessonPlayback } from './useLessonPlayback';
import { XRayQuality } from './XRayQuality';

const spanName: Record<string, string> = {
  lesson_script: '生成离线剧本',
  interrupt_continuation: '生成打断续讲',
};

export function XRayDrawer({
  playback,
  dialogue,
  onEvidence,
  onClose,
}: {
  playback: ReturnType<typeof useLessonPlayback>;
  dialogue: PlayedDialogue;
  onEvidence: (number: number, source: PlayedDialogue) => void;
  onClose: () => void;
}) {
  const { sessionId, generation, played, records, pendingBeat, saving } = playback;
  const lastStep = played.at(-1)?.step_id ?? 0;
  const [trace, setTrace] = useState<SessionTrace>();
  const [traceError, setTraceError] = useState('');
  const [retryTrace, setRetryTrace] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh this read when a played step, input, generation, or explicit retry changes.
  useEffect(() => {
    if (!sessionId || saving) return;
    let active = true;
    request<SessionTrace>(`${sessionPath(sessionId)}/xray`, undefined, { cache: 'no-store' }).then(
      (data) => {
        if (!active) return;
        setTrace(data);
        setTraceError('');
      },
      (error: unknown) => {
        if (active) setTraceError(errorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [sessionId, generation, lastStep, records.length, saving, retryTrace]);

  const current = trace?.generation === generation ? trace : undefined;
  const truncated = records.reduce(
    (total, record) => total + (record.kind === 'interrupt' ? record.truncated_step_ids.length : 0),
    0,
  );
  return (
    <Sheet
      open
      modal={false}
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPopup
        showBackdrop={false}
        initialFocus={false}
        finalFocus={false}
        className="inset-y-auto bottom-0 h-[var(--lesson-xray-short-height)] w-full max-w-none border-t border-ink/10 bg-drawer shadow-none lg:h-[calc(100dvh-3.5rem)] lg:w-[var(--lesson-xray-width)] lg:border-t-0"
      >
        <SheetHeader className="bg-drawer px-5 py-3.5">
          <SheetTitle className="flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            Agent X-Ray
          </SheetTitle>
          <SheetDescription>教学状态机、对话投影与六维质检</SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="stream" className="min-h-0 flex-1 gap-0">
          <div className="shrink-0 px-5">
            <TabsList aria-label="工程透视视图">
              <TabsTab value="stream" aria-label="动作流与状态机">
                动作与状态
              </TabsTab>
              <TabsTab value="dialogue" aria-label="公开对话投影与追踪">
                对话与追踪
              </TabsTab>
              <TabsTab value="quality" aria-label="eduharness 6 维质检">
                6 维质检
              </TabsTab>
            </TabsList>
          </div>
          <TabsPanel
            value="stream"
            className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain p-4 sm:px-5"
          >
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">已播 {played.length} 步</Badge>
              <Badge variant="secondary">截断 {truncated} 步</Badge>
              {generation !== undefined && (
                <Badge variant="muted" className="font-mono">
                  G{generation}
                </Badge>
              )}
            </div>
            <Section title="TeachingState 真实跃迁">
              {traceError ? (
                <div className="space-y-2">
                  <p role="alert" className="text-xs text-accent">
                    {traceError}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setRetryTrace((n) => n + 1)}>
                    重试读取
                  </Button>
                </div>
              ) : current ? (
                <ol className="space-y-2 text-xs">
                  {current.transitions.map(({ from, to, step_id, generation }) => (
                    <li
                      key={`${generation}:${step_id}:${to}`}
                      data-state-to={to}
                      className="flex flex-wrap items-center justify-between gap-x-2"
                    >
                      <span className="font-mono text-ink-secondary">
                        {from ? `${from} → ` : ''}
                        <strong className="font-semibold text-accent">{to}</strong>
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-muted">
                        G{generation} · 拍 {step_id}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty>正在等待读取会话…</Empty>
              )}
            </Section>
            <Section title="动作队列">
              {pendingBeat && (
                <p className="mb-2.5 rounded-lg bg-accent-soft/65 px-2.5 py-1.5 text-xs text-accent">
                  待播队列 ·{' '}
                  <span className="font-mono">
                    seq {pendingBeat.seq} · 拍 {pendingBeat.action.step_id}{' '}
                    {pendingBeat.action.type}
                  </span>
                </p>
              )}
              <ol className="space-y-1.5 text-xs">
                {played.slice(-5).map(({ type, step_id }) => (
                  <QueueRow key={step_id} step={step_id} kind={type} status="已播" />
                ))}
                {current?.queued
                  .filter(({ step_id }) => step_id > lastStep)
                  .map(({ type, step_id }) => (
                    <QueueRow key={step_id} step={step_id} kind={type} status="待播" />
                  ))}
              </ol>
              {!played.length && !current?.queued.length && <Empty>尚无动作。</Empty>}
            </Section>
          </TabsPanel>
          <TabsPanel
            value="dialogue"
            className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain p-4 sm:px-5"
          >
            <Section title="耗时与步骤追踪">
              {current?.spans.length ? (
                <ul className="space-y-2 text-xs">
                  {current.spans.map(({ kind, name, durationMs, generation, step_id }) => (
                    <li
                      key={`${generation}:${step_id}:${name}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-2"
                    >
                      <span className="font-medium text-ink">{spanName[name] ?? name}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted">
                        {kind === 'tool' ? 'tool · ' : ''}G{generation} · 拍 {step_id} ·{' '}
                        {durationMs.toFixed(2)} ms
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>暂无已记录的耗时。</Empty>
              )}
            </Section>
            <Section title={`公开对话 · ${dialogue.turns.length} 回合`}>
              {dialogue.turns.length === 0 && <Empty>白板开始演播后显示。</Empty>}
              <ol className="space-y-3.5">
                {dialogue.turns.map(({ turnNumber, role, text, evidenceStepIds, interrupted }) => (
                  <li key={turnNumber} data-public-turn={turnNumber} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <EvidenceLink
                        number={turnNumber}
                        onClick={() => onEvidence(turnNumber, dialogue)}
                      />
                      <span
                        className={
                          role === 'teacher'
                            ? 'text-xs font-medium text-ink'
                            : 'text-xs font-medium text-accent'
                        }
                      >
                        {role === 'teacher' ? '老师' : interrupted ? '学生 · 插话' : '学生'}
                      </span>
                      {evidenceStepIds.length > 0 && (
                        <span className="font-mono text-[10.5px] tabular-nums text-muted">
                          拍 {evidenceStepIds[0]}
                          {evidenceStepIds.length > 1
                            ? `–${evidenceStepIds.at(-1)}（${evidenceStepIds.length} 步）`
                            : ''}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-[12.8px] leading-[1.72] text-ink-secondary [overflow-wrap:anywhere]">
                      {text}
                    </p>
                  </li>
                ))}
              </ol>
            </Section>
          </TabsPanel>
          <TabsPanel
            value="quality"
            keepMounted
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 sm:px-5"
          >
            <XRayQuality
              sessionId={sessionId}
              generation={generation}
              lastStep={lastStep}
              recordCount={records.length}
              saving={saving}
              onEvidence={onEvidence}
            />
          </TabsPanel>
        </Tabs>
      </SheetPopup>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-[10px] border border-ink/8 bg-drawer-surface px-4 py-3.5">
      <h3 className="font-serif text-[13.5px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted">{children}</p>;
}

function QueueRow({ step, kind, status }: { step: number; kind: string; status: string }) {
  return (
    <li className="flex items-center justify-between gap-2 text-ink-secondary">
      <span className="font-mono text-[11.5px] tabular-nums">
        {step} · {kind}
      </span>
      <span className="text-[11px] text-muted">{status}</span>
    </li>
  );
}
