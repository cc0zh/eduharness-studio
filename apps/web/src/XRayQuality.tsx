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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">eduharness 6 维质检</h3>
        <Button size="sm" onClick={() => void grade()} disabled={!sessionId || saving || busy}>
          <FlaskConical aria-hidden="true" /> {busy ? '质检中…' : '运行离线质检'}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted">e1-binary-v3 · 离线规则近似，不是 LLM 裁判</p>
      {error && (
        <p role="alert" className="text-xs text-amber-900">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="flex flex-wrap justify-between gap-x-2 text-xs text-muted">
            <span>
              {old ? '课堂已推进 · ' : ''}结果截至第 {result.last_played_step_id} 拍
            </span>
            <span>
              适用分 {result.scoring.points} / {result.scoring.possible}
            </span>
          </p>
          <ul aria-label="六维质检结果" className="grid grid-cols-2 gap-1.5">
            {OFFLINE_DIMENSION_IDS.map((id) => {
              const score = result.scoring.scores[id];
              return (
                <li
                  key={id}
                  data-quality-dimension={id}
                  className="flex flex-wrap items-center justify-between gap-x-1 rounded-lg border border-border px-2 py-1"
                >
                  <span className="text-xs font-semibold text-ink">
                    {OFFLINE_DIMENSIONS[id].label}
                  </span>
                  <Badge
                    variant={score === 2 ? 'default' : score === 1 ? 'secondary' : 'muted'}
                    className="tabular-nums"
                  >
                    {score === 'N/A' ? 'N/A' : `${score} / 2`}
                  </Badge>
                </li>
              );
            })}
          </ul>
          <details className="group rounded-lg border border-border">
            <summary className="cursor-pointer rounded-md px-2.5 py-2 text-xs font-semibold text-primary hover:bg-primary-soft/30 focus-visible:outline-2 focus-visible:outline-primary">
              19 题明细 · 0 / 1 与证据
            </summary>
            <ol aria-label="19 题判定" className="divide-y divide-border border-t border-border">
              {OFFLINE_DIMENSION_IDS.flatMap((dimension) =>
                Object.entries(OFFLINE_DIMENSIONS[dimension].questions).map(([id, label]) => {
                  const { score, evidence } = result.answers[id as OfflineQuestion];
                  const numbers = [...new Set(Object.values(evidence ?? {}))].sort((a, b) => a - b);
                  return (
                    <li
                      key={id}
                      data-quality-question={id}
                      className="grid min-h-7 grid-cols-[1.6rem_minmax(0,1fr)_auto] items-center gap-1 px-2 py-0.5 text-xs"
                    >
                      <span className="font-mono font-semibold text-primary">{id}</span>
                      <span className="leading-4 text-slate-700">{label}</span>
                      <div className="flex max-w-40 flex-wrap items-center justify-end gap-0.5">
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
                          variant={score === 1 ? 'secondary' : 'muted'}
                          className="ml-0.5 tabular-nums"
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
