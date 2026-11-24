import {
  OFFLINE_DIMENSION_IDS,
  OFFLINE_DIMENSIONS,
  type OfflineQuestion,
  type PlayedDialogue,
  type SessionQuality,
} from '@eduharness-studio/engine';
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage, request } from '@/lib/courses';
import { EvidenceLink } from './EvidenceLink';
import { sessionPath } from './lesson-session';

export function XRayQuality({
  sessionId,
  generation,
  lastStep,
  recordCount,
  saving,
  onEvidence,
}: {
  sessionId?: string;
  generation?: number;
  lastStep: number;
  recordCount: number;
  saving: boolean;
  onEvidence: (number: number, source: PlayedDialogue) => void;
}) {
  const [result, setResult] = useState<SessionQuality>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const old =
    result &&
    (result.generation !== generation ||
      result.last_played_step_id !== lastStep ||
      result.dialogue.recordTurnNumbers.length !== recordCount);

  async function grade() {
    if (!sessionId || saving || busy) return;
    setBusy(true);
    setError('');
    try {
      setResult(await request<SessionQuality>(`${sessionPath(sessionId)}/quality`, {}));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rounded-[10px] border border-ink/8 bg-drawer-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-serif text-[14px] font-semibold text-ink">eduharness 6 维质检</h3>
          <Button
            size="sm"
            className="rounded-lg"
            onClick={() => void grade()}
            disabled={!sessionId || saving || busy}
          >
            <FlaskConical className="size-3.5" aria-hidden="true" />{' '}
            {busy ? '质检中…' : '运行离线质检'}
          </Button>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-5 text-muted">
          <span className="font-mono">e1-binary-v3</span> · 离线规则近似，不是 LLM 裁判
        </p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-accent">
            {error}
          </p>
        )}
        {result && (
          <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-2 border-t border-border/80 pt-2 text-xs">
            <span className="text-muted">
              {old ? '课堂已推进 · ' : ''}截至第 {result.last_played_step_id} 拍
            </span>
            <span className="font-serif text-sm font-semibold tabular-nums text-ink">
              适用分 {result.scoring.points} / {result.scoring.possible}
            </span>
          </div>
        )}
      </div>

      {result && (
        <>
          <ul aria-label="六维质检结果" className="grid grid-cols-2 gap-1.5">
            {OFFLINE_DIMENSION_IDS.map((id) => {
              const score = result.scoring.scores[id];
              return (
                <li
                  key={id}
                  data-quality-dimension={id}
                  className="flex flex-wrap items-center justify-between gap-x-1 rounded-lg border border-ink/8 bg-drawer-surface px-2.5 py-1.5"
                >
                  <span className="text-xs font-medium text-ink">
                    {OFFLINE_DIMENSIONS[id].label}
                  </span>
                  <Badge
                    variant={score === 2 ? 'default' : score === 1 ? 'outline' : 'muted'}
                    className="font-mono text-[10.5px] tabular-nums"
                  >
                    {score === 'N/A' ? 'N/A' : `${score} / 2`}
                  </Badge>
                </li>
              );
            })}
          </ul>
          <details className="group overflow-hidden rounded-[10px] border border-ink/8 bg-drawer-surface">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-hover/60 focus-visible:outline-2 focus-visible:outline-ink">
              19 题明细 · 0 / 1 与证据
            </summary>
            <ol
              aria-label="19 题判定"
              className="divide-y divide-border-faint/80 border-t border-border/80"
            >
              {OFFLINE_DIMENSION_IDS.flatMap((dimension) =>
                Object.entries(OFFLINE_DIMENSIONS[dimension].questions).map(([id, label]) => {
                  const { score, evidence } = result.answers[id as OfflineQuestion];
                  const numbers = [...new Set(Object.values(evidence ?? {}))].sort((a, b) => a - b);
                  return (
                    <li
                      key={id}
                      data-quality-question={id}
                      className="grid min-h-6 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-1.5 px-2.5 py-0.5 text-[11.5px]"
                    >
                      <span className="font-mono font-semibold text-accent">{id}</span>
                      <span className="leading-4 text-ink-secondary">{label}</span>
                      <div className="flex max-w-40 flex-wrap items-center justify-end gap-1">
                        {numbers.map((number) => (
                          <EvidenceLink
                            key={number}
                            number={number}
                            bracketed
                            onClick={() => onEvidence(number, result.dialogue)}
                          />
                        ))}
                        <Badge
                          data-question-score={score}
                          aria-label={`题分 ${score}`}
                          variant={score === 1 ? 'outline' : 'muted'}
                          className="font-mono text-[10.5px] tabular-nums"
                        >
                          {score}
                        </Badge>
                      </div>
                    </li>
                  );
                }),
              )}
            </ol>
          </details>
        </>
      )}
    </>
  );
}
