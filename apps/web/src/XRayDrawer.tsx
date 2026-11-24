import type { PlayedDialogue, SessionTrace } from '@eduharness-studio/engine';
import { ScanLine } from 'lucide-react';
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
        className="inset-y-auto bottom-0 h-[var(--lesson-xray-short-height)] w-full max-w-none border-t shadow-[-10px_0_32px_-20px_#0f5250] lg:h-[calc(100dvh-4rem)] lg:w-[var(--lesson-xray-width)]"
      >
        <SheetHeader className="bg-slate-50/80">
          <SheetTitle className="flex items-center gap-2 text-primary">
            <ScanLine aria-hidden="true" className="size-4" /> Agent X-Ray
          </SheetTitle>
          <SheetDescription>工程透视 · 离线课堂</SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="stream" className="min-h-0 flex-1 gap-0">
          <div className="shrink-0 border-b border-border px-3 py-2">
            <TabsList aria-label="工程透视视图" className="h-auto bg-slate-100 p-1">
              <TabsTab
                value="stream"
                aria-label="动作流与状态机"
                className="min-h-8 px-1 focus-visible:ring-2 focus-visible:ring-primary"
              >
                动作与状态
              </TabsTab>
              <TabsTab
                value="dialogue"
                aria-label="公开对话投影与追踪"
                className="min-h-8 px-1 focus-visible:ring-2 focus-visible:ring-primary"
              >
                对话与追踪
              </TabsTab>
              <TabsTab
                value="quality"
                aria-label="eduharness 6 维质检"
                className="min-h-8 px-1 focus-visible:ring-2 focus-visible:ring-primary"
              >
                6 维质检
              </TabsTab>
            </TabsList>
          </div>
          <TabsPanel
            value="stream"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
          >
            <div className="flex flex-wrap gap-2">
              <Badge>已播 {played.length} 步</Badge>
              <Badge variant="muted">截断 {truncated} 步</Badge>
              {generation !== undefined && <Badge variant="outline">G{generation}</Badge>}
            </div>
            <Section title="TeachingState 真实跃迁">
              {traceError ? (
                <div className="space-y-2">
                  <p role="alert" className="text-xs text-amber-900">
                    {traceError}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setRetryTrace((n) => n + 1)}>
                    重试读取
                  </Button>
                </div>
              ) : current ? (
                <ol className="space-y-1.5 font-mono text-xs">
                  {current.transitions.map(({ from, to, step_id, generation }) => (
                    <li
                      key={`${generation}:${step_id}:${to}`}
                      data-state-to={to}
                      className="flex flex-wrap items-center justify-between gap-x-2"
                    >
                      <span>
                        {from ? `${from} → ` : ''}
                        <strong className="text-primary">{to}</strong>
                      </span>
                      <span className="text-muted">
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
                <p className="mb-2 font-mono text-xs text-primary">
                  已接收待播 · seq {pendingBeat.seq} · 拍 {pendingBeat.action.step_id}{' '}
                  {pendingBeat.action.type}
                </p>
              )}
              <ol className="divide-y divide-border font-mono text-xs">
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
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
          >
            <Section title="离线耗时与步骤追踪">
              {current?.spans.length ? (
                <ul className="space-y-1.5 text-xs">
                  {current.spans.map(({ kind, name, durationMs, generation, step_id }) => (
                    <li
                      key={`${generation}:${step_id}:${name}`}
                      className="flex flex-wrap items-center justify-between gap-x-2"
                    >
                      <span className="font-medium text-primary">{spanName[name] ?? name}</span>
                      <span className="font-mono text-muted">
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
              <ol className="divide-y divide-border">
                {dialogue.turns.map(({ turnNumber, role, text, evidenceStepIds, interrupted }) => (
                  <li
                    key={turnNumber}
                    data-public-turn={turnNumber}
                    className="py-2 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <EvidenceLink
                        number={turnNumber}
                        onClick={() => onEvidence(turnNumber, dialogue)}
                      />
                      <span className="text-xs font-semibold text-primary">
                        {role === 'teacher' ? '老师' : interrupted ? '学生 · 插话' : '学生'}
                      </span>
                      {evidenceStepIds.length > 0 && (
                        <span className="font-mono text-[11px] text-muted">
                          拍 {evidenceStepIds[0]}
                          {evidenceStepIds.length > 1
                            ? `–${evidenceStepIds.at(-1)}（${evidenceStepIds.length} 步）`
                            : ''}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700 [overflow-wrap:anywhere]">
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
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
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
    <section className="space-y-2 border-b border-border pb-3 last:border-0">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}

function QueueRow({ step, kind, status }: { step: number; kind: string; status: string }) {
  return (
    <li className="flex justify-between gap-2 py-1.5">
      <span>
        {step} · {kind}
      </span>
      <span className="text-muted">{status}</span>
    </li>
  );
}
